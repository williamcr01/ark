import { normalizeEditorSelectionFields, parseGenerateMessages } from '@ark/chat/chat.ts'
import type { ApiChatMessage } from '@ark/chat/chat.ts'
import type { CreateGenerationJobInput } from '@ark/chat/generation-job.ts'
import { ACTIVE_GENERATION_JOB_STATUSES } from '@ark/chat/generation-job.ts'
import { type StartGenerationJobRequest } from '@ark/contracts'
import { deckOriginIsUnauthored } from '@ark/deck/document/origin.ts'
import {
  catalogSupportsAttachments,
  findCatalogEntryByRef,
  resolveCatalogReasoningEffort,
} from '@ark/ai/model-catalog.ts'
import { resolveAssetAttachments } from '@ark/storage/records/asset-resolve.ts'
import {
  ensureChatThreadForJob,
  formatTerminalGenerationChatContent,
  persistLatestUserMessage,
} from '@ark/storage/records/chat-persistence.ts'
import { cloneGenerationJobRequest } from '@ark/storage/records/generation-job-record.ts'
import type { JobRunnerDeps } from './context.ts'

export type StartGenerationJobOptions = {
  body: StartGenerationJobRequest
  defaultModel: string | null
  requestId?: string | null
}

export type BuiltRetryJob = {
  input: CreateGenerationJobInput
  requestId: string | null
}

function throwJobApiError(error: string, code = 'provider_error', apiError = error): never {
  throw Object.assign(new Error(error), {
    apiError: {
      code,
      error: apiError,
    },
  })
}

function parseAndValidateStartMessages(body: StartGenerationJobRequest): ApiChatMessage[] {
  const parsedMessages = parseGenerateMessages(body.messages)

  if (!parsedMessages.ok) {
    throwJobApiError(parsedMessages.error)
  }

  const messages = parsedMessages.messages

  if (messages.length === 0) {
    throwJobApiError('At least one user message is required.')
  }

  if (messages.at(-1)?.role !== 'user') {
    throwJobApiError('The latest chat message must be from the user.')
  }

  return messages
}

async function resolveStartJobModel(
  deps: JobRunnerDeps,
  body: StartGenerationJobRequest,
  defaultModel: string | null,
  messages: ApiChatMessage[],
  assetIds: string[],
) {
  const requestedRef = body.model?.trim() || defaultModel
  if (!requestedRef) {
    throwJobApiError('No available model. Add a provider key in Settings.', 'missing_api_key')
  }

  await deps.assertModelAvailable(requestedRef)
  const modelRef = requestedRef
  const { provider } = deps.createModel(modelRef)
  const catalogEntry = findCatalogEntryByRef(modelRef)
  const resolvedEffort = resolveCatalogReasoningEffort(catalogEntry, body.reasoningEffort ?? null)

  if (!resolvedEffort.ok) {
    throwJobApiError(resolvedEffort.error)
  }

  const messagesHaveAttachments = messages.some((message) => (message.attachments?.length ?? 0) > 0)

  if (
    !catalogSupportsAttachments(catalogEntry) &&
    (messagesHaveAttachments || assetIds.length > 0)
  ) {
    const modelName = catalogEntry?.name ?? modelRef
    throwJobApiError(`${modelName} is text-only and does not support attachments.`)
  }

  return { modelRef, provider, resolvedEffort }
}

async function validateStartJobAssets(
  deps: JobRunnerDeps,
  deckId: string | null,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return
  }

  if (!deps.assetStore) {
    throwJobApiError('Asset storage is not configured.')
  }

  const resolved = await resolveAssetAttachments(
    { assetStore: deps.assetStore },
    deckId,
    assetIds,
    {
      strict: true,
    },
  )

  if (!resolved.ok) {
    throwJobApiError(
      'One or more asset ids could not be resolved.',
      'provider_error',
      `Could not resolve asset(s): ${resolved.assetIds.join(', ')}`,
    )
  }
}

async function assertNoInFlightGeneration(deps: JobRunnerDeps, deckId: string | null) {
  if (!deckId) {
    return
  }

  const jobs = await deps.jobStore.listJobsForDeck(deckId)
  const inFlight = jobs.find((job) => ACTIVE_GENERATION_JOB_STATUSES.has(job.status))

  if (inFlight) {
    throwJobApiError('A generation job is already in progress for this deck.')
  }
}

function applyEditorSelectionsToLatestUser(
  body: StartGenerationJobRequest,
  messages: ApiChatMessage[],
) {
  const selectionFields = normalizeEditorSelectionFields({
    editorSelection: body.editorSelection,
    editorSelections: body.editorSelections,
  })

  const rawLastUser = [...(body.messages ?? [])]
    .reverse()
    .find((message) => message.role === 'user')
  const rawMessageSelections = rawLastUser?.context?.editorSelections
  const messageSentPluralSelections =
    Array.isArray(rawMessageSelections) && rawMessageSelections.length > 1

  if (selectionFields.editorSelections?.length) {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    if (lastUser) {
      const fromMessage = normalizeEditorSelectionFields({
        editorSelection: lastUser.context?.editorSelection,
        editorSelections: lastUser.context?.editorSelections,
      })
      const resolved =
        messageSentPluralSelections && fromMessage.editorSelections?.length
          ? fromMessage
          : selectionFields
      lastUser.context = {
        ...lastUser.context,
        ...resolved,
      }
    }
  }

  return selectionFields
}

async function bindStartJobChatThread(
  deps: JobRunnerDeps,
  deckId: string | null,
  messages: ApiChatMessage[],
) {
  if (!deckId || !deps.chatStore) {
    return null
  }

  const thread = await ensureChatThreadForJob(deps.chatStore, deps.deckStore, deckId)

  if (!thread) {
    return null
  }

  await persistLatestUserMessage(deps.chatStore, deckId, messages)
  return thread.id
}

export async function buildStartJobInput(
  deps: JobRunnerDeps,
  { body, defaultModel }: StartGenerationJobOptions,
): Promise<CreateGenerationJobInput> {
  const messages = parseAndValidateStartMessages(body)
  const currentHtml = body.currentHtml ?? ''
  const deckId = typeof body.deckId === 'string' && body.deckId.trim() ? body.deckId.trim() : null
  const assetIds = body.assetIds?.map((id) => id.trim()).filter(Boolean) ?? []
  const { modelRef, provider, resolvedEffort } = await resolveStartJobModel(
    deps,
    body,
    defaultModel,
    messages,
    assetIds,
  )

  await validateStartJobAssets(deps, deckId, assetIds)
  await assertNoInFlightGeneration(deps, deckId)

  // The renderer cannot be trusted to know whether the deck is still Ark's
  // untouched starter, so read the origin from the stored record.
  const deckOrigin = deckId ? ((await deps.deckStore.getDeck(deckId))?.origin ?? null) : null
  const selectionFields = applyEditorSelectionsToLatestUser(body, messages)
  const chatThreadId = await bindStartJobChatThread(deps, deckId, messages)
  const baseDocumentRevision = body.baseDocumentRevision ?? null

  return {
    deckId,
    baseDocumentRevision,
    chatThreadId,
    assetIds: assetIds.length > 0 ? assetIds : undefined,
    model: modelRef,
    provider,
    request: {
      messages,
      currentHtml,
      baseDocumentRevision,
      editingExistingDeck: Boolean(
        deckId && currentHtml.trim() && !deckOriginIsUnauthored(deckOrigin),
      ),
      ...(deckOrigin ? { deckOrigin } : {}),
      ...(selectionFields.editorSelection
        ? { editorSelection: selectionFields.editorSelection }
        : {}),
      ...(selectionFields.editorSelections?.length
        ? { editorSelections: selectionFields.editorSelections }
        : {}),
      ...(body.slideContexts && body.slideContexts.length > 0
        ? { slideContexts: body.slideContexts }
        : {}),
      ...(resolvedEffort.effort ? { reasoningEffort: resolvedEffort.effort } : {}),
    },
  }
}

function appendRetryTurn(
  request: CreateGenerationJobInput['request'],
  failedAssistant: {
    id: string
    content: string
    parts?: ApiChatMessage['parts']
  },
): ApiChatMessage {
  const controlMessage: ApiChatMessage = {
    role: 'user',
    content: 'Retry previous request',
  }
  request.messages.push(
    {
      id: failedAssistant.id,
      role: 'assistant',
      content: failedAssistant.content,
      ...(failedAssistant.parts ? { parts: structuredClone(failedAssistant.parts) } : {}),
    },
    controlMessage,
  )
  return controlMessage
}

export async function buildRetryJob(
  deps: JobRunnerDeps,
  jobId: string,
): Promise<BuiltRetryJob | null> {
  const existing = await deps.jobStore.getJob(jobId)

  if (
    !existing ||
    existing.status === 'succeeded' ||
    existing.status === 'queued' ||
    existing.status === 'running' ||
    existing.status === 'canceling'
  ) {
    return null
  }

  const request = cloneGenerationJobRequest(existing.request)
  const deckId = existing.deckId
  let baseDocumentRevision = existing.baseDocumentRevision
  let retryControlMessage: ApiChatMessage | null = null

  if (deps.chatStore && deckId) {
    const chat = await deps.chatStore.listMessages(deckId, { limit: 500 })
    const failedAssistant = [...chat.messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.generationJobId === existing.id)

    if (failedAssistant) {
      retryControlMessage = appendRetryTurn(request, {
        id: failedAssistant.id,
        content: failedAssistant.content,
        parts: failedAssistant.parts,
      })
    }
  } else if (!deckId) {
    // New-deck failures never hit chat persistence; keep the failure turn on the
    // cloned request so a later successful retry still records it.
    retryControlMessage = appendRetryTurn(request, {
      id: existing.id,
      content: formatTerminalGenerationChatContent({
        status: existing.status === 'canceled' ? 'canceled' : 'failed',
        steps: existing.progress.steps,
        editingExistingDeck: false,
        error: existing.error,
      }),
    })
  }

  if (deckId) {
    const deck = await deps.deckStore.getDeck(deckId)

    if (deck) {
      baseDocumentRevision = deck.documentRevision
      request.currentHtml = deck.html
      request.baseDocumentRevision = baseDocumentRevision
      request.deckOrigin = deck.origin
      // A retry after a failed first generation still faces a blank deck.
      request.editingExistingDeck = !deckOriginIsUnauthored(deck.origin)
    }
  }

  if (deps.chatStore && deckId && retryControlMessage) {
    const persisted = await deps.chatStore.appendMessage(deckId, {
      role: 'user',
      content: retryControlMessage.content,
    })
    retryControlMessage.id = persisted.id
  }

  await deps.assertModelAvailable(existing.model)

  return {
    input: {
      deckId,
      baseDocumentRevision,
      assetIds: existing.assetIds,
      model: existing.model,
      provider: existing.provider,
      request,
      retryOfJobId: existing.id,
    },
    requestId: existing.observability?.requestId ?? null,
  }
}
