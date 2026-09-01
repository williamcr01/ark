import { randomUUID } from 'node:crypto'
import { type LanguageModel } from 'ai'

import {
  applyResolvedAssetAttachments,
  collectAssetIdsFromMessages,
  isReadableTextMediaType,
  normalizeEditorSelectionFields,
  parseGenerateMessages,
} from '@ark/chat/chat.ts'
import type { ApiChatMessage, ChatAttachment } from '@ark/chat/chat.ts'
import type {
  CreateGenerationJobInput,
  GenerationJob,
  GenerationJobStatus,
} from '@ark/chat/generation-job.ts'
import { type GenerationJobResponse, type StartGenerationJobRequest } from '@ark/contracts'
import { ACTIVE_GENERATION_JOB_STATUSES } from '@ark/chat/generation-job.ts'
import { buildArkAssetUrl } from '@ark/deck/document/assets.ts'
import { deckOriginIsUnauthored } from '@ark/deck/document/origin.ts'
import { toGenerationJobApi } from './job-wire.ts'
import { runDeckAgent, type RunDeckAgentResult } from './agent.ts'
import { validateDeckHtmlOnServer } from '@ark/deck/validate/timed.ts'
import { type DeckStore } from '@ark/storage/records/deck-record.ts'
import { type ChatStore } from '@ark/storage/records/chat-record.ts'
import { resolveAssetAttachments } from '@ark/storage/records/asset-resolve.ts'
import { type AssetRecord, type AssetStore } from '@ark/storage/records/asset-record.ts'
import {
  ensureChatThreadForJob,
  formatTerminalGenerationChatContent,
  persistAssistantGenerationMessage,
  persistInitialDeckChatHistory,
  persistLatestUserMessage,
} from '@ark/storage/records/chat-persistence.ts'
import {
  cloneGenerationJobRequest,
  type GenerationJobStore,
} from '@ark/storage/records/generation-job-record.ts'
import { createLanguageModel } from '@ark/ai/provider-runtime.ts'
import { buildOpaquePromptCacheKey } from '@ark/ai/prompt-cache-options.ts'
import { categorizeProviderError } from '@ark/ai/provider-errors.ts'
import { createLogger } from '@ark/telemetry/logger.ts'
import {
  catalogSupportsAttachments,
  findCatalogEntryByRef,
  resolveCatalogReasoningEffort,
} from '@ark/ai/model-catalog.ts'
import { clearModelCatalogCache } from '@ark/ai/models.ts'
import { WorkspaceDocumentConflictError } from '@ark/storage/stores/workspace-store.ts'

function invalidateModelCatalogOnAuthFailure(errorCategory: string | null | undefined) {
  if (errorCategory === 'invalid_api_key' || errorCategory === 'missing_api_key') {
    clearModelCatalogCache()
  }
}

export type GenerationJobRunnerOptions = {
  deckStore: DeckStore
  jobStore: GenerationJobStore
  chatStore?: ChatStore | null
  assetStore?: AssetStore | null
  createModel?: typeof createLanguageModel
  runAgent?: (options: Parameters<typeof runDeckAgent>[0]) => Promise<RunDeckAgentResult>
  now?: () => Date
  onDocumentPersisted?: (deckId: string, documentRevision: number) => void
}

export type StartGenerationJobOptions = {
  body: StartGenerationJobRequest
  defaultModel: string
  requestId?: string | null
}

/**
 * Build model-facing messages with resolved asset bytes. Prior user turns keep
 * their referenced files; the latest turn also receives any extra `assetIds`
 * selected for this job.
 */
function prepareMessagesForModel(
  messages: ApiChatMessage[],
  resolvedById: ReadonlyMap<string, ChatAttachment>,
  latestTurnAssetIds: readonly string[],
): ApiChatMessage[] {
  const withHistory = applyResolvedAssetAttachments(messages, resolvedById)

  if (latestTurnAssetIds.length === 0) {
    return withHistory
  }

  const lastUserIndex = withHistory.map((message) => message.role).lastIndexOf('user')

  if (lastUserIndex === -1) {
    return withHistory
  }

  return withHistory.map((message, index) => {
    if (index !== lastUserIndex) {
      return message
    }

    const existing = message.attachments ?? []
    const existingAssetIds = new Set(
      existing.map((attachment) => attachment.assetId).filter(Boolean),
    )
    const extras = latestTurnAssetIds
      .map((id) => resolvedById.get(id))
      .filter((attachment): attachment is ChatAttachment => Boolean(attachment))
      .filter((attachment) => !existingAssetIds.has(attachment.assetId))

    if (extras.length === 0) {
      return message
    }

    return { ...message, attachments: [...existing, ...extras] }
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
  assetStore = null,
  createModel = createLanguageModel,
  runAgent = runDeckAgent,
  now = () => new Date(),
  onDocumentPersisted,
}: GenerationJobRunnerOptions): GenerationJobRunner {
  const notifyDocumentPersisted = (deckId: string, documentRevision: number) =>
    onDocumentPersisted?.(deckId, documentRevision)
  const persistTerminalAssistantMessage = async (
    job: GenerationJob,
    options: {
      status: GenerationJobStatus
      steps: GenerationJob['progress']['steps']
      transcriptParts?: import('@ark/chat/chat.ts').ChatMessagePart[]
      assistantText?: string | null
      deckId: string
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
      transcriptParts: options.transcriptParts,
      assistantText: options.assistantText,
      editingExistingDeck: job.request.editingExistingDeck ?? false,
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

      let modelMessages = currentJob.request.messages
      let attachmentInspector: Parameters<typeof runDeckAgent>[0]['attachmentInspector']

      const historyAssetIds = collectAssetIdsFromMessages(currentJob.request.messages)
      const latestTurnAssetIds = currentJob.assetIds ?? []
      const allAssetIds = [...new Set([...historyAssetIds, ...latestTurnAssetIds])]

      if (allAssetIds.length > 0 && assetStore) {
        const resolved = await resolveAssetAttachments(
          { assetStore },
          currentJob.deckId,
          allAssetIds,
        )

        if (resolved.ok) {
          const records = (
            await Promise.all(
              allAssetIds.map(async (id) =>
                currentJob.deckId ? assetStore.getAsset(currentJob.deckId, id) : null,
              ),
            )
          ).filter((record): record is AssetRecord => Boolean(record?.deckId === currentJob.deckId))
          const recordsById = new Map(records.map((record) => [record.id, record]))
          attachmentInspector = {
            attachments: records.map((record) => ({
              id: record.id,
              filename: record.filename,
              mediaType: record.mediaType,
              byteSize: record.byteSize,
              url: buildArkAssetUrl(record.id),
            })),
            read: async (id) => {
              const record = recordsById.get(id)
              return record && currentJob.deckId
                ? assetStore.readBytes(currentJob.deckId, record.id)
                : null
            },
          }
          const modelAttachments = new Map(
            [...resolved.byId].map(([id, attachment]) => {
              const record = recordsById.get(id)
              return [
                id,
                record && isReadableTextMediaType(record.mediaType)
                  ? {
                      ...attachment,
                      url: buildArkAssetUrl(id),
                    }
                  : attachment,
              ]
            }),
          )
          modelMessages = prepareMessagesForModel(
            currentJob.request.messages,
            modelAttachments,
            latestTurnAssetIds,
          )
        }
      }

      const agentResult = await runAgent({
        model: model as LanguageModel,
        provider,
        modelRef: currentJob.model,
        messages: modelMessages,
        currentHtml: currentJob.request.currentHtml,
        deckOrigin: currentJob.request.deckOrigin,
        editorSelection: currentJob.request.editorSelection,
        editorSelections: currentJob.request.editorSelections,
        slideContexts: currentJob.request.slideContexts,
        reasoningEffort: currentJob.request.reasoningEffort,
        promptCacheKey: buildOpaquePromptCacheKey({
          deckId: currentJob.deckId,
          chatThreadId: currentJob.chatThreadId,
        }),
        abortSignal: abortController.signal,
        logger: jobLogger,
        attachmentInspector,
        onStepProgress: async (steps) => {
          const latestStep = steps.at(-1)

          jobLogger.debug('generation.job.step', {
            stepCount: steps.length,
            latestStepType: latestStep?.type ?? null,
            latestToolName: latestStep?.toolName ?? null,
            elapsedMs: Math.round(performance.now() - jobStartedAt),
          })

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
            transcriptParts: agentResult.transcriptParts,
            assistantText: canceledJob.progress.assistantText,
            deckId: canceledJob.deckId,
            error: { message: 'Generation was canceled.', code: 'canceled' },
          })
        }

        return
      }

      if (!agentResult.ok) {
        const errorCategory = agentResult.providerMetrics?.errorCategory ?? 'provider_error'
        invalidateModelCatalogOnAuthFailure(errorCategory)

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
            errorCategory,
          },
          observability,
          completedAt: now().toISOString(),
        })

        jobLogger.warn('generation.job.failed', {
          durationMs: observability.durationMs,
          errorCategory,
          stepCount: agentResult.steps.length,
        })

        if (failedJob?.deckId) {
          await persistTerminalAssistantMessage(failedJob, {
            status: 'failed',
            steps: agentResult.steps,
            transcriptParts: agentResult.transcriptParts,
            deckId: failedJob.deckId,
            error: failedJob.error,
          })
        }

        return
      }

      const targetDeckId = refreshed.deckId
      const baseDocumentRevision = refreshed.baseDocumentRevision

      if (
        !targetDeckId &&
        (agentResult.awaitingUserResponse ||
          (agentResult.changed === false && !agentResult.html.trim()))
      ) {
        await jobStore.updateJob(jobId, {
          status: 'succeeded',
          progress: {
            steps: agentResult.steps,
            stepCount: agentResult.steps.length,
            assistantText: agentResult.assistantText,
            transcriptParts: agentResult.transcriptParts,
          },
          result: null,
          observability,
          completedAt: now().toISOString(),
        })

        jobLogger.info('generation.job.succeeded', {
          changed: false,
          awaitingUserResponse: true,
          durationMs: observability.durationMs,
          stepCount: agentResult.steps.length,
          tokenUsage: agentResult.providerMetrics?.tokenUsage ?? null,
        })

        return
      }

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
              transcriptParts: agentResult.transcriptParts,
              assistantText: agentResult.assistantText,
              deckId: failedJob.deckId,
              error: failedJob.error,
            })
          }

          return
        }

        const currentDocumentRevision = existingDeck.documentRevision

        if (baseDocumentRevision !== null && baseDocumentRevision !== currentDocumentRevision) {
          const failedJob = await jobStore.updateJob(jobId, {
            status: 'failed',
            progress: {
              steps: agentResult.steps,
              stepCount: agentResult.steps.length,
              assistantText: agentResult.assistantText,
            },
            error: {
              message:
                'The deck changed while generation was running. Retry from the latest document.',
              code: 'document_conflict',
            },
            observability,
            completedAt: now().toISOString(),
          })

          if (failedJob?.deckId) {
            await persistTerminalAssistantMessage(failedJob, {
              status: 'failed',
              steps: agentResult.steps,
              transcriptParts: agentResult.transcriptParts,
              assistantText: agentResult.assistantText,
              deckId: failedJob.deckId,
              error: failedJob.error,
            })
          }

          return
        }

        if (agentResult.changed === false) {
          // Persist chat before marking the job terminal so clients (and tests)
          // that poll job status then read chat never observe a succeeded job
          // without its assistant turn.
          await persistTerminalAssistantMessage(refreshed, {
            status: 'succeeded',
            steps: agentResult.steps,
            transcriptParts: agentResult.transcriptParts,
            assistantText: agentResult.assistantText,
            deckId: existingDeck.id,
          })

          await jobStore.updateJob(jobId, {
            status: 'succeeded',
            deckId: existingDeck.id,
            progress: {
              steps: agentResult.steps,
              stepCount: agentResult.steps.length,
              assistantText: agentResult.assistantText,
              ...(agentResult.awaitingUserResponse
                ? { transcriptParts: agentResult.transcriptParts }
                : {}),
            },
            result: {
              deckId: existingDeck.id,
              documentRevision: existingDeck.documentRevision,
              html: existingDeck.html,
              validation: agentResult.validation,
              assistantText: agentResult.assistantText,
            },
            observability,
            completedAt: now().toISOString(),
          })

          jobLogger.info('generation.job.succeeded', {
            changed: false,
            awaitingUserResponse: Boolean(agentResult.awaitingUserResponse),
            durationMs: observability.durationMs,
            stepCount: agentResult.steps.length,
            tokenUsage: agentResult.providerMetrics?.tokenUsage ?? null,
          })

          return
        }

        const updatedDeck = await deckStore.updateDeck(targetDeckId, agentResult.html, {
          expectedDocumentRevision: currentDocumentRevision,
          historySource: 'agent',
        })

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
              transcriptParts: agentResult.transcriptParts,
              deckId: failedJob.deckId,
              error: failedJob.error,
            })
          }

          return
        }

        const succeededJob = await jobStore.updateJob(jobId, {
          deckId: updatedDeck.id,
          progress: {
            steps: agentResult.steps,
            stepCount: agentResult.steps.length,
            assistantText: agentResult.assistantText,
          },
          result: {
            deckId: updatedDeck.id,
            documentRevision: updatedDeck.documentRevision,
            html: updatedDeck.html,
            validation: agentResult.validation,
            assistantText: agentResult.assistantText,
          },
          observability,
        })

        if (succeededJob) {
          await persistTerminalAssistantMessage(succeededJob, {
            status: 'succeeded',
            steps: agentResult.steps,
            transcriptParts: agentResult.transcriptParts,
            assistantText: agentResult.assistantText,
            deckId: updatedDeck.id,
          })
        }

        await jobStore.updateJob(jobId, {
          status: 'succeeded',
          completedAt: now().toISOString(),
        })

        jobLogger.info('generation.job.succeeded', {
          durationMs: observability.durationMs,
          stepCount: agentResult.steps.length,
          tokenUsage: agentResult.providerMetrics?.tokenUsage ?? null,
        })

        notifyDocumentPersisted(updatedDeck.id, updatedDeck.documentRevision)

        return
      }

      const newDeckId = randomUUID()
      const finalizedHtml = agentResult.html
      const finalValidation = validateDeckHtmlOnServer(finalizedHtml, { logger: jobLogger })
      if (!finalValidation.valid) {
        throw new Error(
          finalValidation.issues.find((issue) => issue.severity === 'error')?.message ??
            'Finalized deck HTML is invalid.',
        )
      }

      const createdDeck = await deckStore.createDeck(finalizedHtml, undefined, newDeckId)

      if (chatStore) {
        await persistInitialDeckChatHistory(chatStore, createdDeck.id, refreshed.request.messages)
      }

      const preparedJob = await jobStore.updateJob(jobId, {
        deckId: createdDeck.id,
        progress: {
          steps: agentResult.steps,
          stepCount: agentResult.steps.length,
          assistantText: agentResult.assistantText,
        },
        result: {
          deckId: createdDeck.id,
          documentRevision: createdDeck.documentRevision,
          html: createdDeck.html,
          validation: finalValidation,
          assistantText: agentResult.assistantText,
        },
        observability,
      })

      if (preparedJob) {
        await persistTerminalAssistantMessage(preparedJob, {
          status: 'succeeded',
          steps: agentResult.steps,
          transcriptParts: agentResult.transcriptParts,
          assistantText: agentResult.assistantText,
          deckId: createdDeck.id,
        })
      }

      await jobStore.updateJob(jobId, {
        status: 'succeeded',
        completedAt: now().toISOString(),
      })

      jobLogger.info('generation.job.succeeded', {
        durationMs: observability.durationMs,
        stepCount: agentResult.steps.length,
        tokenUsage: agentResult.providerMetrics?.tokenUsage ?? null,
      })

      notifyDocumentPersisted(createdDeck.id, createdDeck.documentRevision)
    } catch (error) {
      const latest = await jobStore.getJob(jobId)
      const durationMs = Math.round(performance.now() - jobStartedAt)
      const errorDetails =
        error instanceof WorkspaceDocumentConflictError
          ? {
              category: 'document_conflict',
              apiErrorCode: 'document_conflict' as const,
            }
          : categorizeProviderError(error)

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
      invalidateModelCatalogOnAuthFailure(errorDetails.category)

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

  const startJob = async ({ body, defaultModel, requestId = null }: StartGenerationJobOptions) => {
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
    const catalogEntry = findCatalogEntryByRef(modelRef)
    const resolvedEffort = resolveCatalogReasoningEffort(catalogEntry, body.reasoningEffort ?? null)

    if (!resolvedEffort.ok) {
      throw Object.assign(new Error(resolvedEffort.error), {
        apiError: {
          code: 'provider_error',
          error: resolvedEffort.error,
        },
      })
    }

    const currentHtml = body.currentHtml ?? ''
    const deckId = typeof body.deckId === 'string' && body.deckId.trim() ? body.deckId.trim() : null
    const assetIds = body.assetIds?.map((id) => id.trim()).filter(Boolean) ?? []
    const messagesHaveAttachments = messages.some(
      (message) => (message.attachments?.length ?? 0) > 0,
    )

    if (
      !catalogSupportsAttachments(catalogEntry) &&
      (messagesHaveAttachments || assetIds.length > 0)
    ) {
      const modelName = catalogEntry?.name ?? modelRef
      const error = `${modelName} is text-only and does not support attachments.`
      throw Object.assign(new Error(error), {
        apiError: {
          code: 'provider_error',
          error,
        },
      })
    }

    if (assetIds.length > 0) {
      if (!assetStore) {
        throw Object.assign(new Error('Asset storage is not configured.'), {
          apiError: {
            code: 'provider_error',
            error: 'Asset storage is not configured.',
          },
        })
      }

      const resolved = await resolveAssetAttachments({ assetStore }, deckId, assetIds, {
        strict: true,
      })

      if (!resolved.ok) {
        throw Object.assign(new Error('One or more asset ids could not be resolved.'), {
          apiError: {
            code: 'provider_error',
            error: `Could not resolve asset(s): ${resolved.assetIds.join(', ')}`,
          },
        })
      }
    }

    const baseDocumentRevision = body.baseDocumentRevision ?? null

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

    // The renderer cannot be trusted to know whether the deck is still Ark's
    // untouched starter, so read the origin from the stored record.
    const deckOrigin = deckId ? ((await deckStore.getDeck(deckId))?.origin ?? null) : null

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

    let chatThreadId: string | null = null

    if (deckId && chatStore) {
      const thread = await ensureChatThreadForJob(chatStore, deckStore, deckId)

      if (thread) {
        chatThreadId = thread.id
        await persistLatestUserMessage(chatStore, deckId, messages)
      }
    }

    const input: CreateGenerationJobInput = {
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
    let baseDocumentRevision = existing.baseDocumentRevision
    let retryControlMessage: ApiChatMessage | null = null

    const appendRetryTurn = (failedAssistant: {
      id: string
      content: string
      parts?: ApiChatMessage['parts']
    }): ApiChatMessage => {
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

    if (chatStore && deckId) {
      const chat = await chatStore.listMessages(deckId, { limit: 500 })
      const failedAssistant = [...chat.messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.generationJobId === existing.id)

      if (failedAssistant) {
        retryControlMessage = appendRetryTurn({
          id: failedAssistant.id,
          content: failedAssistant.content,
          parts: failedAssistant.parts,
        })
      }
    } else if (!deckId) {
      // New-deck failures never hit chat persistence; keep the failure turn on the
      // cloned request so a later successful retry still records it.
      retryControlMessage = appendRetryTurn({
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
      const deck = await deckStore.getDeck(deckId)

      if (deck) {
        baseDocumentRevision = deck.documentRevision
        request.currentHtml = deck.html
        request.baseDocumentRevision = baseDocumentRevision
        request.deckOrigin = deck.origin
        // A retry after a failed first generation still faces a blank deck.
        request.editingExistingDeck = !deckOriginIsUnauthored(deck.origin)
      }
    }

    if (chatStore && deckId && retryControlMessage) {
      const persisted = await chatStore.appendMessage(deckId, {
        role: 'user',
        content: retryControlMessage.content,
      })
      retryControlMessage.id = persisted.id
    }

    const input: CreateGenerationJobInput = {
      deckId,
      baseDocumentRevision,
      assetIds: existing.assetIds,
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
  return { job: toGenerationJobApi(job) }
}
