import { type LanguageModel } from 'ai'

import { parseGenerateMessages } from '../shared/chat.ts'
import type {
  CreateGenerationJobInput,
  GenerationJob,
  GenerationJobStatus,
  StartGenerationJobRequest,
} from '../shared/generation-job.ts'
import { runDeckAgent } from './deck-agent.ts'
import { type DeckStore } from './deck-record.ts'
import { cloneGenerationJobRequest, type GenerationJobStore } from './generation-job-record.ts'
import { createLanguageModel } from './provider-runtime.ts'

export type GenerationJobRunnerOptions = {
  deckStore: DeckStore
  jobStore: GenerationJobStore
  createModel?: typeof createLanguageModel
  now?: () => Date
}

export type StartGenerationJobOptions = {
  body: StartGenerationJobRequest
  defaultModel: string
}

export type GenerationJobRunner = {
  startJob: (options: StartGenerationJobOptions) => Promise<GenerationJob>
  retryJob: (jobId: string) => Promise<GenerationJob | null>
  cancelJob: (jobId: string) => Promise<GenerationJob | null>
  getJob: (jobId: string) => Promise<GenerationJob | null>
}

const runningControllers = new Map<string, AbortController>()

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isTerminalStatus(status: GenerationJobStatus) {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}

export function createGenerationJobRunner({
  deckStore,
  jobStore,
  createModel = createLanguageModel,
  now = () => new Date(),
}: GenerationJobRunnerOptions): GenerationJobRunner {
  const processJob = async (jobId: string) => {
    const job = await jobStore.getJob(jobId)

    if (!job || job.status !== 'queued') {
      return
    }

    const abortController = new AbortController()
    runningControllers.set(jobId, abortController)

    const startedAt = now().toISOString()
    await jobStore.updateJob(jobId, {
      status: 'running',
      startedAt,
    })

    const currentJob = await jobStore.getJob(jobId)

    if (!currentJob) {
      runningControllers.delete(jobId)
      return
    }

    try {
      const { model, provider } = createModel(currentJob.model)

      const agentResult = await runDeckAgent({
        model: model as LanguageModel,
        messages: currentJob.request.messages,
        currentHtml: currentJob.request.currentHtml,
        abortSignal: abortController.signal,
        onStepProgress: async (steps) => {
          const latest = await jobStore.getJob(jobId)

          if (!latest || latest.status === 'canceling' || latest.status === 'canceled') {
            abortController.abort()
            return
          }

          await jobStore.updateJob(jobId, {
            progress: {
              steps,
              stepCount: steps.length,
              assistantText: latest.progress.assistantText ?? null,
            },
          })
        },
      })

      const refreshed = await jobStore.getJob(jobId)

      if (!refreshed || refreshed.status === 'canceling') {
        await jobStore.updateJob(jobId, {
          status: 'canceled',
          completedAt: now().toISOString(),
        })
        return
      }

      if (!agentResult.ok) {
        await jobStore.updateJob(jobId, {
          status: 'failed',
          progress: {
            steps: agentResult.steps,
            stepCount: agentResult.steps.length,
            assistantText: null,
          },
          error: {
            message: agentResult.error,
            code: 'provider_error',
            validation: agentResult.validation,
          },
          completedAt: now().toISOString(),
        })
        return
      }

      const targetDeckId = refreshed.deckId
      const baseVersionId = refreshed.baseVersionId

      if (targetDeckId) {
        const existingDeck = await deckStore.getDeck(targetDeckId)

        if (!existingDeck) {
          await jobStore.updateJob(jobId, {
            status: 'failed',
            progress: {
              steps: agentResult.steps,
              stepCount: agentResult.steps.length,
              assistantText: agentResult.assistantText,
            },
            error: {
              message: 'The target deck no longer exists.',
              code: 'deck_not_found',
            },
            completedAt: now().toISOString(),
          })
          return
        }

        const currentActiveVersionId = existingDeck.activeVersionId ?? null

        if (baseVersionId && currentActiveVersionId && baseVersionId !== currentActiveVersionId) {
          await jobStore.updateJob(jobId, {
            status: 'failed',
            progress: {
              steps: agentResult.steps,
              stepCount: agentResult.steps.length,
              assistantText: agentResult.assistantText,
            },
            error: {
              message:
                'The deck changed while generation was running. Retry from the latest version.',
              code: 'version_conflict',
            },
            completedAt: now().toISOString(),
          })
          return
        }

        const updatedDeck = await deckStore.updateDeck(targetDeckId, agentResult.html, {
          source: 'agent',
          summary: refreshed.request.editingExistingDeck ? 'AI edit' : 'AI generation',
          modelProvider: provider,
          modelName: refreshed.model,
          validationStatus: 'valid',
        })

        if (!updatedDeck) {
          await jobStore.updateJob(jobId, {
            status: 'failed',
            error: {
              message: 'Could not save the generated deck.',
              code: 'save_failed',
            },
            completedAt: now().toISOString(),
          })
          return
        }

        await jobStore.updateJob(jobId, {
          status: 'succeeded',
          deckId: updatedDeck.id,
          progress: {
            steps: agentResult.steps,
            stepCount: agentResult.steps.length,
            assistantText: agentResult.assistantText,
          },
          result: {
            deckId: updatedDeck.id,
            versionId: updatedDeck.activeVersionId ?? '',
            html: updatedDeck.html,
            validation: agentResult.validation,
            assistantText: agentResult.assistantText,
          },
          completedAt: now().toISOString(),
        })
        return
      }

      const createdDeck = await deckStore.createDeck(agentResult.html, {
        source: 'agent',
        summary: 'AI generation',
        modelProvider: provider,
        modelName: refreshed.model,
        validationStatus: 'valid',
      })

      await jobStore.updateJob(jobId, {
        status: 'succeeded',
        deckId: createdDeck.id,
        progress: {
          steps: agentResult.steps,
          stepCount: agentResult.steps.length,
          assistantText: agentResult.assistantText,
        },
        result: {
          deckId: createdDeck.id,
          versionId: createdDeck.activeVersionId ?? '',
          html: createdDeck.html,
          validation: agentResult.validation,
          assistantText: agentResult.assistantText,
        },
        completedAt: now().toISOString(),
      })
    } catch (error) {
      const latest = await jobStore.getJob(jobId)

      if (isAbortError(error) || latest?.status === 'canceling') {
        await jobStore.updateJob(jobId, {
          status: 'canceled',
          completedAt: now().toISOString(),
        })
        return
      }

      const message = error instanceof Error ? error.message : 'Generation failed.'

      await jobStore.updateJob(jobId, {
        status: 'failed',
        error: {
          message,
          code: 'provider_error',
        },
        completedAt: now().toISOString(),
      })
    } finally {
      runningControllers.delete(jobId)
    }
  }

  const enqueueJob = (jobId: string) => {
    void processJob(jobId)
  }

  const startJob = async ({ body, defaultModel }: StartGenerationJobOptions) => {
    const parsedMessages = parseGenerateMessages(body.messages)

    if (!parsedMessages.ok) {
      throw Object.assign(new Error(parsedMessages.error), {
        apiError: {
          code: 'provider_error',
          error: parsedMessages.error,
        },
      })
    }

    const messages = parsedMessages.messages

    if (messages.length === 0) {
      throw Object.assign(new Error('At least one user message is required.'), {
        apiError: {
          code: 'provider_error',
          error: 'At least one user message is required.',
        },
      })
    }

    if (messages.at(-1)?.role !== 'user') {
      throw Object.assign(new Error('The latest chat message must be from the user.'), {
        apiError: {
          code: 'provider_error',
          error: 'The latest chat message must be from the user.',
        },
      })
    }

    const modelRef = body.model?.trim() || defaultModel
    const { provider } = createModel(modelRef)
    const currentHtml = body.currentHtml ?? ''
    const deckId = typeof body.deckId === 'string' && body.deckId.trim() ? body.deckId.trim() : null
    const baseVersionId =
      typeof body.baseVersionId === 'string' && body.baseVersionId.trim()
        ? body.baseVersionId.trim()
        : null

    const input: CreateGenerationJobInput = {
      deckId,
      baseVersionId,
      model: modelRef,
      provider,
      request: {
        messages,
        currentHtml,
        baseVersionId,
        editingExistingDeck: Boolean(deckId && currentHtml.trim()),
      },
    }

    const job = await jobStore.createJob(input)
    enqueueJob(job.id)
    return job
  }

  const retryJob = async (jobId: string) => {
    const existing = await jobStore.getJob(jobId)

    if (
      !existing ||
      existing.status === 'succeeded' ||
      existing.status === 'queued' ||
      existing.status === 'running' ||
      existing.status === 'canceling'
    ) {
      return null
    }

    const input: CreateGenerationJobInput = {
      deckId: existing.deckId,
      baseVersionId: existing.baseVersionId,
      model: existing.model,
      provider: existing.provider,
      request: cloneGenerationJobRequest(existing.request),
      retryOfJobId: existing.id,
    }

    const job = await jobStore.createJob(input)
    enqueueJob(job.id)
    return job
  }

  const cancelJob = async (jobId: string) => {
    const existing = await jobStore.getJob(jobId)

    if (!existing) {
      return null
    }

    if (isTerminalStatus(existing.status)) {
      return existing
    }

    const controller = runningControllers.get(jobId)
    controller?.abort()

    if (existing.status === 'queued') {
      return jobStore.updateJob(jobId, {
        status: 'canceled',
        completedAt: now().toISOString(),
      })
    }

    return jobStore.updateJob(jobId, {
      status: 'canceling',
    })
  }

  const getJob = async (jobId: string) => jobStore.getJob(jobId)

  return {
    startJob,
    retryJob,
    cancelJob,
    getJob,
  }
}

export function toGenerationJobResponse(job: GenerationJob) {
  return {
    job: {
      id: job.id,
      deckId: job.deckId,
      baseVersionId: job.baseVersionId,
      status: job.status,
      model: job.model,
      provider: job.provider,
      progress: job.progress,
      result: job.result
        ? {
            deckId: job.result.deckId,
            versionId: job.result.versionId,
            html: job.result.html,
            validation: job.result.validation,
            assistantText: job.result.assistantText,
          }
        : null,
      error: job.error,
      retryOfJobId: job.retryOfJobId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    },
  }
}
