import { type LanguageModel } from 'ai'

import { parseGenerateMessages } from '../shared/chat.ts'
import type { ApiChatMessage, ChatAttachment } from '../shared/chat.ts'
import type {
  CreateGenerationJobInput,
  GenerationJob,
  GenerationJobStatus,
} from '../shared/generation-job.ts'
import type {
  GenerationJobApi,
  GenerationJobResponse,
  StartGenerationJobRequest,
} from '../shared/api/generation-jobs.ts'
import { deckValidationReportSchema } from '../shared/api/decks.ts'
import { ACTIVE_GENERATION_JOB_STATUSES } from '../shared/generation-job.ts'
import { runDeckAgent, type RunDeckAgentResult } from './deck-agent.ts'
import { type DeckStore } from './deck-record.ts'
import { buildDeckVersionOptions } from './deck-version-payload.ts'
import { type ChatStore } from './chat-record.ts'
import {
  ensureChatThreadForJob,
  persistAssistantGenerationMessage,
  persistInitialDeckChatHistory,
  persistLatestUserMessage,
} from './chat-persistence.ts'
import { cloneGenerationJobRequest, type GenerationJobStore } from './generation-job-record.ts'
import { createLanguageModel } from './provider-runtime.ts'
import { categorizeProviderError } from './observability/provider-errors.ts'
import { createLogger } from './observability/logger.ts'

export type GenerationJobRunnerOptions = {
  deckStore: DeckStore
  jobStore: GenerationJobStore
  chatStore?: ChatStore | null
  createModel?: typeof createLanguageModel
  runAgent?: (options: Parameters<typeof runDeckAgent>[0]) => Promise<RunDeckAgentResult>
  now?: () => Date
}

export type StartGenerationJobOptions = {
  body: StartGenerationJobRequest
  defaultModel: string
  /**
   * Inline attachments resolved from uploaded asset ids. Merged into the model
   * input for the latest user turn, but NOT into the lightweight chat history.
   */
  assetAttachments?: ChatAttachment[]
  requestId?: string | null
}

/**
 * Merge resolved asset attachments into the latest user message so the model
 * receives the bytes, while the persisted chat history stays reference-only.
 */
function withResolvedAttachments(
  messages: ApiChatMessage[],
  attachments: ChatAttachment[],
): ApiChatMessage[] {
  if (attachments.length === 0) {
    return messages
  }

  const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user')

  if (lastUserIndex === -1) {
    return messages
  }

  return messages.map((message, index) => {
    if (index !== lastUserIndex) {
      return message
    }

    const existing = message.attachments ?? []
    const existingAssetIds = new Set(
      existing.map((attachment) => attachment.assetId).filter(Boolean),
    )
    const merged = [
      ...existing,
      ...attachments.filter((attachment) => !existingAssetIds.has(attachment.assetId)),
    ]

    return { ...message, attachments: merged }
  })
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
  chatStore = null,
  createModel = createLanguageModel,
  runAgent = runDeckAgent,
  now = () => new Date(),
}: GenerationJobRunnerOptions): GenerationJobRunner {
  const persistTerminalAssistantMessage = async (
    job: GenerationJob,
    options: {
      status: GenerationJobStatus
      steps: GenerationJob['progress']['steps']
      assistantText?: string | null
      deckId: string
      deckVersionId?: string | null
      error?: GenerationJob['error']
    },
  ) => {
    if (!chatStore) {
      return
    }

    await persistAssistantGenerationMessage(chatStore, options.deckId, {
      jobId: job.id,
      model: job.model,
      status: options.status,
      steps: options.steps,
      assistantText: options.assistantText,
      editingExistingDeck: job.request.editingExistingDeck ?? false,
      deckVersionId: options.deckVersionId ?? null,
      error: options.error ?? null,
    })
  }

  const processJob = async (jobId: string, requestId: string | null = null) => {
    const claimed = await jobStore.claimQueuedJob(jobId, now().toISOString())

    if (!claimed) {
      return
    }

    const abortController = new AbortController()
    runningControllers.set(jobId, abortController)
    const currentJob = claimed
    const jobLogger = createLogger({
      service: 'ark-generation',
      requestId,
      jobId,
      deckId: currentJob.deckId,
    })
    const jobStartedAt = performance.now()

    jobLogger.info('generation.job.started', {
      model: currentJob.model,
      provider: currentJob.provider,
      status: currentJob.status,
    })

    try {
      const { model, provider } = createModel(currentJob.model)

      const agentResult = await runAgent({
        model: model as LanguageModel,
        provider,
        modelRef: currentJob.model,
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

      const observability = {
        requestId,
        providerMetrics: agentResult.providerMetrics ?? null,
        durationMs: Math.round(performance.now() - jobStartedAt),
      }

      const refreshed = await jobStore.getJob(jobId)

      if (!refreshed || refreshed.status === 'canceling') {
        const canceledJob = await jobStore.updateJob(jobId, {
          status: 'canceled',
          observability,
          completedAt: now().toISOString(),
        })

        jobLogger.info('generation.job.canceled', {
          durationMs: observability.durationMs,
        })

        if (canceledJob?.deckId) {
          await persistTerminalAssistantMessage(canceledJob, {
            status: 'canceled',
            steps: canceledJob.progress.steps,
            assistantText: canceledJob.progress.assistantText,
            deckId: canceledJob.deckId,
            error: { message: 'Generation was canceled.', code: 'canceled' },
          })
        }

        return
      }

      if (!agentResult.ok) {
        const failedJob = await jobStore.updateJob(jobId, {
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
            errorCategory: agentResult.providerMetrics?.errorCategory ?? 'provider_error',
          },
          observability,
          completedAt: now().toISOString(),
        })

        jobLogger.warn('generation.job.failed', {
          durationMs: observability.durationMs,
          errorCategory: agentResult.providerMetrics?.errorCategory ?? 'provider_error',
          stepCount: agentResult.steps.length,
        })

        if (failedJob?.deckId) {
          await persistTerminalAssistantMessage(failedJob, {
            status: 'failed',
            steps: agentResult.steps,
            deckId: failedJob.deckId,
            error: failedJob.error,
          })
        }

        return
      }

      const targetDeckId = refreshed.deckId
      const baseVersionId = refreshed.baseVersionId

      if (targetDeckId) {
        const existingDeck = await deckStore.getDeck(targetDeckId)

        if (!existingDeck) {
          const failedJob = await jobStore.updateJob(jobId, {
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
            observability,
            completedAt: now().toISOString(),
          })

          if (failedJob?.deckId) {
            await persistTerminalAssistantMessage(failedJob, {
              status: 'failed',
              steps: agentResult.steps,
              assistantText: agentResult.assistantText,
              deckId: failedJob.deckId,
              error: failedJob.error,
            })
          }

          return
        }

        const currentActiveVersionId = existingDeck.activeVersionId ?? null

        if (baseVersionId && currentActiveVersionId && baseVersionId !== currentActiveVersionId) {
          const failedJob = await jobStore.updateJob(jobId, {
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
            observability,
            completedAt: now().toISOString(),
          })

          if (failedJob?.deckId) {
            await persistTerminalAssistantMessage(failedJob, {
              status: 'failed',
              steps: agentResult.steps,
              assistantText: agentResult.assistantText,
              deckId: failedJob.deckId,
              error: failedJob.error,
            })
          }

          return
        }

        const updatedDeck = await deckStore.updateDeck(
          targetDeckId,
          agentResult.html,
          buildDeckVersionOptions(agentResult.html, {
            source: 'agent',
            summary: refreshed.request.editingExistingDeck ? 'AI edit' : 'AI generation',
            modelProvider: provider,
            modelName: refreshed.model,
          }),
        )

        if (!updatedDeck) {
          const failedJob = await jobStore.updateJob(jobId, {
            status: 'failed',
            error: {
              message: 'Could not save the generated deck.',
              code: 'save_failed',
            },
            observability,
            completedAt: now().toISOString(),
          })

          if (failedJob?.deckId) {
            await persistTerminalAssistantMessage(failedJob, {
              status: 'failed',
              steps: agentResult.steps,
              deckId: failedJob.deckId,
              error: failedJob.error,
            })
          }

          return
        }

        const succeededJob = await jobStore.updateJob(jobId, {
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
          observability,
          completedAt: now().toISOString(),
        })

        jobLogger.info('generation.job.succeeded', {
          durationMs: observability.durationMs,
          stepCount: agentResult.steps.length,
          tokenUsage: agentResult.providerMetrics?.tokenUsage ?? null,
        })

        if (succeededJob) {
          await persistTerminalAssistantMessage(succeededJob, {
            status: 'succeeded',
            steps: agentResult.steps,
            assistantText: agentResult.assistantText,
            deckId: updatedDeck.id,
            deckVersionId: updatedDeck.activeVersionId ?? null,
          })
        }

        return
      }

      const createdDeck = await deckStore.createDeck(
        agentResult.html,
        buildDeckVersionOptions(agentResult.html, {
          source: 'agent',
          summary: 'AI generation',
          modelProvider: provider,
          modelName: refreshed.model,
        }),
      )

      if (chatStore) {
        await persistInitialDeckChatHistory(
          chatStore,
          createdDeck.id,
          refreshed.request.messages,
          createdDeck.activeVersionId ?? null,
        )
      }

      const succeededJob = await jobStore.updateJob(jobId, {
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
        observability,
        completedAt: now().toISOString(),
      })

      jobLogger.info('generation.job.succeeded', {
        durationMs: observability.durationMs,
        stepCount: agentResult.steps.length,
        tokenUsage: agentResult.providerMetrics?.tokenUsage ?? null,
      })

      if (succeededJob) {
        await persistTerminalAssistantMessage(succeededJob, {
          status: 'succeeded',
          steps: agentResult.steps,
          assistantText: agentResult.assistantText,
          deckId: createdDeck.id,
          deckVersionId: createdDeck.activeVersionId ?? null,
        })
      }
    } catch (error) {
      const latest = await jobStore.getJob(jobId)
      const durationMs = Math.round(performance.now() - jobStartedAt)
      const errorDetails = categorizeProviderError(error)

      if (isAbortError(error) || latest?.status === 'canceling') {
        const canceledJob = await jobStore.updateJob(jobId, {
          status: 'canceled',
          observability: {
            requestId,
            durationMs,
            providerMetrics: {
              latencyMs: durationMs,
              model: latest?.model ?? currentJob.model,
              provider: latest?.provider ?? currentJob.provider ?? 'unknown',
              errorCategory: 'aborted',
            },
          },
          completedAt: now().toISOString(),
        })

        jobLogger.info('generation.job.canceled', { durationMs })

        if (canceledJob?.deckId) {
          await persistTerminalAssistantMessage(canceledJob, {
            status: 'canceled',
            steps: canceledJob.progress.steps,
            deckId: canceledJob.deckId,
            error: { message: 'Generation was canceled.', code: 'canceled' },
          })
        }

        return
      }

      const message = error instanceof Error ? error.message : 'Generation failed.'

      const failedJob = await jobStore.updateJob(jobId, {
        status: 'failed',
        error: {
          message,
          code: errorDetails.apiErrorCode,
          errorCategory: errorDetails.category,
        },
        observability: {
          requestId,
          durationMs,
          providerMetrics: {
            latencyMs: durationMs,
            model: latest?.model ?? currentJob.model,
            provider: latest?.provider ?? currentJob.provider ?? 'unknown',
            errorCategory: errorDetails.category,
          },
        },
        completedAt: now().toISOString(),
      })

      jobLogger.error('generation.job.failed', {
        durationMs,
        errorCategory: errorDetails.category,
        message,
      })

      if (failedJob?.deckId) {
        await persistTerminalAssistantMessage(failedJob, {
          status: 'failed',
          steps: failedJob.progress.steps,
          deckId: failedJob.deckId,
          error: failedJob.error,
        })
      }
    } finally {
      runningControllers.delete(jobId)
    }
  }

  const enqueueJob = (jobId: string, requestId: string | null = null) => {
    void processJob(jobId, requestId)
  }

  const startJob = async ({
    body,
    defaultModel,
    assetAttachments = [],
    requestId = null,
  }: StartGenerationJobOptions) => {
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

    if (deckId) {
      const jobs = await jobStore.listJobsForDeck(deckId)
      const inFlight = jobs.find((job) => ACTIVE_GENERATION_JOB_STATUSES.has(job.status))

      if (inFlight) {
        throw Object.assign(new Error('A generation job is already in progress for this deck.'), {
          apiError: {
            code: 'provider_error',
            error: 'A generation job is already in progress for this deck.',
          },
        })
      }
    }

    let chatThreadId: string | null = null

    if (deckId && chatStore) {
      const thread = await ensureChatThreadForJob(chatStore, deckStore, deckId, baseVersionId)

      if (thread) {
        chatThreadId = thread.id
        await persistLatestUserMessage(chatStore, deckId, messages, baseVersionId)
      }
    }

    const modelMessages = withResolvedAttachments(messages, assetAttachments)

    const input: CreateGenerationJobInput = {
      deckId,
      baseVersionId,
      chatThreadId,
      model: modelRef,
      provider,
      request: {
        messages: modelMessages,
        currentHtml,
        baseVersionId,
        editingExistingDeck: Boolean(deckId && currentHtml.trim()),
      },
    }

    const job = await jobStore.createJob(input)
    enqueueJob(job.id, requestId)
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

    const request = cloneGenerationJobRequest(existing.request)
    const deckId = existing.deckId
    let baseVersionId = existing.baseVersionId

    if (deckId) {
      const deck = await deckStore.getDeck(deckId)

      if (deck) {
        baseVersionId = deck.activeVersionId ?? null
        request.currentHtml = deck.html
        request.baseVersionId = baseVersionId
        request.editingExistingDeck = true
      }
    }

    const input: CreateGenerationJobInput = {
      deckId,
      baseVersionId,
      model: existing.model,
      provider: existing.provider,
      request,
      retryOfJobId: existing.id,
    }

    const job = await jobStore.createJob(input)
    enqueueJob(job.id, existing.observability?.requestId ?? null)
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
      const canceled =
        (await jobStore.updateJobIfStatus(jobId, 'queued', {
          status: 'canceled',
          completedAt: now().toISOString(),
        })) ?? (await jobStore.getJob(jobId))

      return canceled
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

export function toGenerationJobResponse(job: GenerationJob): GenerationJobResponse {
  const apiJob: GenerationJobApi = {
    id: job.id,
    deckId: job.deckId,
    baseVersionId: job.baseVersionId,
    editingExistingDeck: job.request.editingExistingDeck ?? false,
    status: job.status,
    model: job.model,
    provider: job.provider,
    progress: job.progress,
    observability: job.observability ?? null,
    result: job.result
      ? {
          deckId: job.result.deckId,
          versionId: job.result.versionId,
          validation: deckValidationReportSchema.parse(job.result.validation),
          assistantText: job.result.assistantText,
        }
      : null,
    error: job.error,
    retryOfJobId: job.retryOfJobId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  }

  return { job: apiJob }
}
