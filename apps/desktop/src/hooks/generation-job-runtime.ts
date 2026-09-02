import type { ChatMessage } from '@ark/chat/messages.ts'
import type { EditorSelectionContext, SlideContext } from '@ark/chat/context.ts'
import {
  agentStepsToChatParts,
  buildAssistantMessageContent,
  toApiMessages,
} from '@ark/chat/api-projection.ts'
import type { GenerationJobApi, ReasoningEffort } from '@ark/contracts'
import {
  cancelGenerationJob,
  fetchGenerationJob,
  isActiveGenerationJobStatus,
  retryGenerationJob,
  startGenerationJob,
} from '@/lib/api/generation-job-api'
import { useChatStore } from '@/state/chat-store.ts'

const GENERATION_JOB_STORAGE_PREFIX = 'ark:generation-job:'

export const readStoredJobId = (deckKey: string) => {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }

    return localStorage.getItem(`${GENERATION_JOB_STORAGE_PREFIX}${deckKey}`)
  } catch {
    return null
  }
}

export const writeStoredJobId = (deckKey: string, jobId: string) => {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }

    localStorage.setItem(`${GENERATION_JOB_STORAGE_PREFIX}${deckKey}`, jobId)
  } catch {
    // Ignore storage failures.
  }
}

export const clearStoredJobId = (deckKey: string) => {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }

    localStorage.removeItem(`${GENERATION_JOB_STORAGE_PREFIX}${deckKey}`)
  } catch {
    // Ignore storage failures.
  }
}

export const clearStoredGenerationJob = (deckId: string | null) => {
  clearStoredJobId(deckId ?? 'new')
}

export type GenerationJobOutcome =
  | {
      status: 'succeeded'
      job: GenerationJobApi
      deckChanged: boolean
      awaitingUserResponse: boolean
      assistantParts: ReturnType<typeof agentStepsToChatParts>
      assistantContent: string
    }
  | {
      status: 'failed' | 'canceled'
      job: GenerationJobApi
      message: string
      retryable: boolean
    }

export type UseGenerationJobOptions = {
  deckId: string | null
  baseDocumentRevision: number | null
  selectedModel: string
  reasoningEffort?: ReasoningEffort
  canGenerate: boolean
  onReloadModels?: () => Promise<void>
}

export const POLL_INTERVAL_MS = 800

function jobAwaitingUserResponse(job: GenerationJobApi) {
  const steps = job.progress.steps
  const transcriptParts = job.progress.transcriptParts
  if (transcriptParts && transcriptParts.length > 0) {
    return transcriptParts.some((part) => {
      if (part.type !== 'tool-result') return false
      if (part.toolName !== 'ask_user' && part.toolName !== 'propose_themes') return false
      const output = part.output
      return (
        !!output &&
        typeof output === 'object' &&
        !Array.isArray(output) &&
        (output as { awaitingUserResponse?: unknown }).awaitingUserResponse === true
      )
    })
  }

  return steps.some(
    (step) =>
      step.type === 'tool-result' &&
      (step.toolName === 'ask_user' || step.toolName === 'propose_themes') &&
      !step.error,
  )
}

export function buildOutcome(
  job: GenerationJobApi,
  baseDocumentRevision: number | null,
): GenerationJobOutcome {
  const steps = job.progress.steps
  const transcriptParts = job.progress.transcriptParts
  const awaitingUserResponse = jobAwaitingUserResponse(job)

  if (job.status === 'succeeded' && (job.result || awaitingUserResponse)) {
    const assistantText = job.result?.assistantText ?? job.progress.assistantText ?? ''
    const assistantContent = buildAssistantMessageContent(
      assistantText,
      steps,
      job.editingExistingDeck ?? false,
    )

    return {
      status: 'succeeded',
      job,
      deckChanged: Boolean(
        job.result?.documentRevision && job.result.documentRevision !== baseDocumentRevision,
      ),
      awaitingUserResponse,
      assistantParts:
        transcriptParts && transcriptParts.length > 0
          ? transcriptParts
          : agentStepsToChatParts(steps),
      assistantContent,
    }
  }

  const message =
    job.error?.message ??
    (job.status === 'canceled'
      ? 'Generation was canceled.'
      : 'Something went wrong while generating the deck.')

  return {
    status: job.status === 'canceled' ? 'canceled' : 'failed',
    job,
    message,
    retryable: job.status === 'failed' || job.status === 'canceled',
  }
}

export async function pollUntilTerminal(
  jobId: string,
  pollAbortRef: { current: AbortController | null },
): Promise<GenerationJobApi> {
  pollAbortRef.current?.abort()
  const controller = new AbortController()
  pollAbortRef.current = controller

  while (!controller.signal.aborted) {
    const job = await fetchGenerationJob(jobId, controller.signal)
    useChatStore.getState().setActiveJob(job)

    if (!isActiveGenerationJobStatus(job.status)) {
      return job
    }

    await new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(resolve, POLL_INTERVAL_MS)
      controller.signal.addEventListener(
        'abort',
        () => {
          window.clearTimeout(timeoutId)
          reject(new DOMException('Polling stopped.', 'AbortError'))
        },
        { once: true },
      )
    })
  }

  throw new DOMException('Polling stopped.', 'AbortError')
}

export function finalizeGenerationJob(
  job: GenerationJobApi,
  storageKey: string,
  onReloadModels?: () => Promise<void>,
) {
  clearStoredJobId(storageKey)
  const chat = useChatStore.getState()
  chat.setActiveJob(job)
  chat.setGenerating(false)

  if (job.status === 'failed' || job.status === 'canceled') {
    chat.setFailedJob(job)
    chat.setGenerationError(job.error?.message ?? '')

    const code = job.error?.code
    const category = job.error?.errorCategory
    if (
      code === 'missing_api_key' ||
      code === 'invalid_api_key' ||
      category === 'missing_api_key' ||
      category === 'invalid_api_key'
    ) {
      void onReloadModels?.()
    }
  } else {
    chat.setFailedJob(null)
    chat.setGenerationError('')
  }
}

export async function runGenerationJob(
  jobId: string,
  storageKey: string,
  pollAbortRef: { current: AbortController | null },
  baseDocumentRevision: number | null,
  onReloadModels?: () => Promise<void>,
) {
  const chat = useChatStore.getState()
  chat.setGenerating(true)
  chat.setGenerationError('')
  chat.setFailedJob(null)
  writeStoredJobId(storageKey, jobId)

  try {
    const job = await pollUntilTerminal(jobId, pollAbortRef)
    finalizeGenerationJob(job, storageKey, onReloadModels)
    return buildOutcome(job, baseDocumentRevision)
  } catch (pollError) {
    if (pollError instanceof DOMException && pollError.name === 'AbortError') {
      return null
    }

    const message =
      pollError instanceof Error ? pollError.message : 'Could not track the generation job.'

    useChatStore.getState().setGenerationError(message)
    useChatStore.getState().setGenerating(false)
    clearStoredJobId(storageKey)
    throw pollError
  }
}

export async function startTrackedGeneration(
  messages: ChatMessage[],
  currentHtml: string,
  options: {
    assetIds?: string[]
    deckId?: string | null
    editorSelection?: EditorSelectionContext
    editorSelections?: EditorSelectionContext[]
    slideContexts?: SlideContext[]
  },
  jobOptions: UseGenerationJobOptions,
  pollAbortRef: { current: AbortController | null },
) {
  const chat = useChatStore.getState()
  if (chat.isGenerating || !jobOptions.canGenerate) {
    return null
  }

  const resolvedDeckId = options.deckId !== undefined ? options.deckId : jobOptions.deckId
  const resolvedDeckKey = resolvedDeckId ?? 'new'

  chat.setGenerating(true)
  chat.setGenerationError('')
  chat.setFailedJob(null)

  try {
    const job = await startGenerationJob({
      messages: toApiMessages(messages),
      currentHtml: currentHtml || null,
      model: jobOptions.selectedModel || undefined,
      ...(jobOptions.reasoningEffort ? { reasoningEffort: jobOptions.reasoningEffort } : {}),
      deckId: resolvedDeckId,
      baseDocumentRevision: jobOptions.baseDocumentRevision,
      ...(options.assetIds?.length ? { assetIds: options.assetIds } : {}),
      ...(options.editorSelection ? { editorSelection: options.editorSelection } : {}),
      ...(options.editorSelections?.length ? { editorSelections: options.editorSelections } : {}),
      ...(options.slideContexts?.length ? { slideContexts: options.slideContexts } : {}),
    })

    useChatStore.getState().setActiveJob(job)
    return runGenerationJob(
      job.id,
      resolvedDeckKey,
      pollAbortRef,
      jobOptions.baseDocumentRevision,
      jobOptions.onReloadModels,
    )
  } catch (startError) {
    const code =
      startError &&
      typeof startError === 'object' &&
      'code' in startError &&
      typeof startError.code === 'string'
        ? startError.code
        : null

    if (code === 'missing_api_key' || code === 'invalid_api_key') {
      void jobOptions.onReloadModels?.()
    }

    const message =
      startError instanceof Error ? startError.message : 'Could not start the generation job.'

    useChatStore.getState().setGenerationError(message)
    useChatStore.getState().setGenerating(false)
    throw startError
  }
}

export async function cancelActiveGeneration() {
  const job = useChatStore.getState().activeJob
  if (!job || !isActiveGenerationJobStatus(job.status)) {
    return null
  }

  try {
    const canceled = await cancelGenerationJob(job.id)
    useChatStore.getState().setActiveJob(canceled)
    return canceled
  } catch (cancelError) {
    const message =
      cancelError instanceof Error ? cancelError.message : 'Could not cancel generation.'

    useChatStore.getState().setGenerationError(message)
    throw cancelError
  }
}

export async function retryFailedGeneration(
  jobId: string | undefined,
  pollAbortRef: { current: AbortController | null },
  deckKey: string,
  baseDocumentRevision: number | null,
  onReloadModels?: () => Promise<void>,
) {
  const chat = useChatStore.getState()
  const targetJobId = jobId ?? chat.failedJob?.id

  if (!targetJobId || chat.isGenerating) {
    return null
  }

  chat.setGenerating(true)
  chat.setGenerationError('')
  chat.setFailedJob(null)

  try {
    const job = await retryGenerationJob(targetJobId)
    useChatStore.getState().setActiveJob(job)
    return runGenerationJob(job.id, deckKey, pollAbortRef, baseDocumentRevision, onReloadModels)
  } catch (retryError) {
    const message = retryError instanceof Error ? retryError.message : 'Could not retry generation.'

    useChatStore.getState().setGenerationError(message)
    useChatStore.getState().setGenerating(false)
    throw retryError
  }
}

export async function resumeStoredGenerationJob(
  deckKey: string,
  pollAbortRef: { current: AbortController | null },
  baseDocumentRevision: number | null,
  onReloadModels?: () => Promise<void>,
) {
  const storedJobId = readStoredJobId(deckKey)
  const chat = useChatStore.getState()

  if (!storedJobId || chat.isGenerating) {
    return null
  }

  try {
    const job = await fetchGenerationJob(storedJobId)

    if (!isActiveGenerationJobStatus(job.status)) {
      if (job.status === 'succeeded') {
        clearStoredJobId(deckKey)
        finalizeGenerationJob(job, deckKey, onReloadModels)
        return buildOutcome(job, baseDocumentRevision)
      }

      if (job.status === 'failed' || job.status === 'canceled') {
        useChatStore.getState().setFailedJob(job)
        useChatStore.getState().setGenerationError(job.error?.message ?? '')
      }

      clearStoredJobId(deckKey)
      return null
    }

    return runGenerationJob(job.id, deckKey, pollAbortRef, baseDocumentRevision, onReloadModels)
  } catch {
    clearStoredJobId(deckKey)
    return null
  }
}
