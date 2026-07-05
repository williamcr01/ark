import { useCallback, useEffect, useRef, useState } from 'react'

import {
  agentStepsToChatParts,
  buildAssistantMessageContent,
  toApiMessages,
  type AgentStep,
  type ChatMessage,
} from '../../shared/chat.ts'
import type { GenerationJob, GenerationJobStatus } from '../../shared/generation-job.ts'
import {
  cancelGenerationJob,
  fetchGenerationJob,
  isActiveGenerationJobStatus,
  retryGenerationJob,
  startGenerationJob,
} from '@/lib/generation-job-api'

const GENERATION_JOB_STORAGE_PREFIX = 'ark:generation-job:'

const readStoredJobId = (deckKey: string) => {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }

    return localStorage.getItem(`${GENERATION_JOB_STORAGE_PREFIX}${deckKey}`)
  } catch {
    return null
  }
}

const writeStoredJobId = (deckKey: string, jobId: string) => {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }

    localStorage.setItem(`${GENERATION_JOB_STORAGE_PREFIX}${deckKey}`, jobId)
  } catch {
    // Ignore storage failures.
  }
}

const clearStoredJobId = (deckKey: string) => {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }

    localStorage.removeItem(`${GENERATION_JOB_STORAGE_PREFIX}${deckKey}`)
  } catch {
    // Ignore storage failures.
  }
}

export type GenerationJobOutcome =
  | {
      status: 'succeeded'
      job: GenerationJob
      assistantParts: ReturnType<typeof agentStepsToChatParts>
      assistantContent: string
    }
  | {
      status: 'failed' | 'canceled'
      job: GenerationJob
      message: string
      retryable: boolean
    }

export type UseGenerationJobOptions = {
  deckId: string | null
  baseVersionId: string | null
  selectedModel: string
  canGenerate: boolean
  onReloadModels?: () => Promise<void>
}

const POLL_INTERVAL_MS = 800

export function useGenerationJob({
  deckId,
  baseVersionId,
  selectedModel,
  canGenerate,
  onReloadModels,
}: UseGenerationJobOptions) {
  const [activeJob, setActiveJob] = useState<GenerationJob | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')
  const [failedJob, setFailedJob] = useState<GenerationJob | null>(null)
  const pollAbortRef = useRef<AbortController | null>(null)
  const deckKey = deckId ?? 'new'

  const stopPolling = useCallback(() => {
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
  }, [])

  const pollUntilTerminal = useCallback(
    async (jobId: string): Promise<GenerationJob> => {
      stopPolling()
      const controller = new AbortController()
      pollAbortRef.current = controller

      while (!controller.signal.aborted) {
        const job = await fetchGenerationJob(jobId, controller.signal)
        setActiveJob(job)

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
    },
    [stopPolling],
  )

  const buildOutcome = useCallback((job: GenerationJob): GenerationJobOutcome => {
    if (job.status === 'succeeded' && job.result) {
      const steps = job.progress.steps
      const assistantContent = buildAssistantMessageContent(
        job.result.assistantText,
        steps,
        job.request.editingExistingDeck ?? false,
      )

      return {
        status: 'succeeded',
        job,
        assistantParts: agentStepsToChatParts(steps),
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
  }, [])

  const finalizeJob = useCallback(
    (job: GenerationJob) => {
      clearStoredJobId(deckKey)
      setActiveJob(job)
      setIsGenerating(false)

      if (job.status === 'failed' || job.status === 'canceled') {
        setFailedJob(job)
        setError(job.error?.message ?? '')
      } else {
        setFailedJob(null)
        setError('')
      }
    },
    [deckKey],
  )

  const runJob = useCallback(
    async (jobId: string) => {
      setIsGenerating(true)
      setError('')
      setFailedJob(null)
      writeStoredJobId(deckKey, jobId)

      try {
        const job = await pollUntilTerminal(jobId)
        finalizeJob(job)
        return buildOutcome(job)
      } catch (pollError) {
        if (pollError instanceof DOMException && pollError.name === 'AbortError') {
          return null
        }

        const message =
          pollError instanceof Error ? pollError.message : 'Could not track the generation job.'

        setError(message)
        setIsGenerating(false)
        clearStoredJobId(deckKey)
        throw pollError
      }
    },
    [buildOutcome, deckKey, finalizeJob, pollUntilTerminal],
  )

  const startGeneration = useCallback(
    async (messages: ChatMessage[], currentHtml: string) => {
      if (isGenerating || !canGenerate) {
        return null
      }

      setIsGenerating(true)
      setError('')
      setFailedJob(null)

      try {
        const job = await startGenerationJob({
          messages: toApiMessages(messages),
          currentHtml: currentHtml || null,
          model: selectedModel || undefined,
          deckId,
          baseVersionId,
        })

        setActiveJob(job)
        return runJob(job.id)
      } catch (startError) {
        const code =
          startError &&
          typeof startError === 'object' &&
          'code' in startError &&
          typeof startError.code === 'string'
            ? startError.code
            : null

        if (code === 'missing_api_key' || code === 'invalid_api_key') {
          void onReloadModels?.()
        }

        const message =
          startError instanceof Error ? startError.message : 'Could not start the generation job.'

        setError(message)
        setIsGenerating(false)
        throw startError
      }
    },
    [baseVersionId, canGenerate, deckId, isGenerating, onReloadModels, runJob, selectedModel],
  )

  const cancelGeneration = useCallback(async () => {
    if (!activeJob || !isActiveGenerationJobStatus(activeJob.status)) {
      return null
    }

    try {
      const job = await cancelGenerationJob(activeJob.id)
      setActiveJob(job)
      return job
    } catch (cancelError) {
      const message =
        cancelError instanceof Error ? cancelError.message : 'Could not cancel generation.'

      setError(message)
      throw cancelError
    }
  }, [activeJob])

  const retryGeneration = useCallback(
    async (jobId?: string) => {
      const targetJobId = jobId ?? failedJob?.id

      if (!targetJobId || isGenerating) {
        return null
      }

      setIsGenerating(true)
      setError('')
      setFailedJob(null)

      try {
        const job = await retryGenerationJob(targetJobId)
        setActiveJob(job)
        return runJob(job.id)
      } catch (retryError) {
        const message =
          retryError instanceof Error ? retryError.message : 'Could not retry generation.'

        setError(message)
        setIsGenerating(false)
        throw retryError
      }
    },
    [failedJob?.id, isGenerating, runJob],
  )

  const resumeStoredJob = useCallback(async () => {
    const storedJobId = readStoredJobId(deckKey)

    if (!storedJobId || isGenerating) {
      return null
    }

    try {
      const job = await fetchGenerationJob(storedJobId)

      if (!isActiveGenerationJobStatus(job.status)) {
        if (job.status === 'succeeded') {
          clearStoredJobId(deckKey)
          finalizeJob(job)
          return buildOutcome(job)
        }

        if (job.status === 'failed' || job.status === 'canceled') {
          setFailedJob(job)
          setError(job.error?.message ?? '')
        }

        clearStoredJobId(deckKey)
        return null
      }

      return runJob(job.id)
    } catch {
      clearStoredJobId(deckKey)
      return null
    }
  }, [buildOutcome, deckKey, finalizeJob, isGenerating, runJob])

  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  return {
    activeJob,
    activeSteps: activeJob?.progress.steps ?? ([] as AgentStep[]),
    cancelGeneration,
    error,
    failedJob,
    isGenerating,
    retryGeneration,
    resumeStoredJob,
    setError,
    startGeneration,
    status: (activeJob?.status ?? null) as GenerationJobStatus | null,
  }
}
