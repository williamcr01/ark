import type { GenerationJobObservability } from '@ark/chat/generation-job.ts'
import { categorizeProviderError } from '@ark/ai/provider-errors.ts'
import { clearModelCatalogCache } from '@ark/ai/models.ts'
import { WorkspaceDocumentConflictError } from '@ark/storage/stores/workspace-store.ts'
import type { RunDeckAgentResult } from '../agent.ts'
import type { JobContext } from './context.ts'
import { persistTerminalAssistantMessage } from './persist.ts'

function invalidateModelCatalogOnAuthFailure(errorCategory: string | null | undefined) {
  if (errorCategory === 'invalid_api_key' || errorCategory === 'missing_api_key') {
    clearModelCatalogCache()
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export async function completeCanceledAfterRun(
  ctx: JobContext,
  agentResult: RunDeckAgentResult,
  observability: GenerationJobObservability,
) {
  const canceledJob = await ctx.stores.jobStore.updateJob(ctx.job.id, {
    status: 'canceled',
    observability,
    completedAt: ctx.now().toISOString(),
  })

  ctx.logger.info('generation.job.canceled', {
    durationMs: observability.durationMs,
  })

  if (canceledJob?.deckId) {
    await persistTerminalAssistantMessage(ctx, canceledJob, {
      status: 'canceled',
      steps: canceledJob.progress.steps,
      transcriptParts: agentResult.transcriptParts,
      assistantText: canceledJob.progress.assistantText,
      deckId: canceledJob.deckId,
      error: { message: 'Generation was canceled.', code: 'canceled' },
    })
  }
}

export async function failFromAgentResult(
  ctx: JobContext,
  agentResult: Extract<RunDeckAgentResult, { ok: false }>,
  observability: GenerationJobObservability,
) {
  const errorCategory = agentResult.providerMetrics?.errorCategory ?? 'provider_error'
  invalidateModelCatalogOnAuthFailure(errorCategory)

  const failedJob = await ctx.stores.jobStore.updateJob(ctx.job.id, {
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
    completedAt: ctx.now().toISOString(),
  })

  ctx.logger.warn('generation.job.failed', {
    durationMs: observability.durationMs,
    errorCategory,
    stepCount: agentResult.steps.length,
  })

  if (failedJob?.deckId) {
    await persistTerminalAssistantMessage(ctx, failedJob, {
      status: 'failed',
      steps: agentResult.steps,
      transcriptParts: agentResult.transcriptParts,
      deckId: failedJob.deckId,
      error: failedJob.error,
    })
  }
}

export async function handleProcessJobError(ctx: JobContext, error: unknown) {
  const jobId = ctx.job.id
  const latest = await ctx.stores.jobStore.getJob(jobId)
  const durationMs = Math.round(performance.now() - ctx.jobStartedAt)
  const errorDetails =
    error instanceof WorkspaceDocumentConflictError
      ? {
          category: 'document_conflict',
          apiErrorCode: 'document_conflict' as const,
        }
      : categorizeProviderError(error)

  if (isAbortError(error) || latest?.status === 'canceling') {
    await completeCanceledFromError(ctx, latest, durationMs)
    return
  }

  const message = error instanceof Error ? error.message : 'Generation failed.'
  invalidateModelCatalogOnAuthFailure(errorDetails.category)

  const failedJob = await ctx.stores.jobStore.updateJob(jobId, {
    status: 'failed',
    error: {
      message,
      code: errorDetails.apiErrorCode,
      errorCategory: errorDetails.category,
    },
    observability: {
      requestId: ctx.requestId,
      durationMs,
      providerMetrics: {
        latencyMs: durationMs,
        model: latest?.model ?? ctx.job.model,
        provider: latest?.provider ?? ctx.job.provider ?? 'unknown',
        errorCategory: errorDetails.category,
      },
    },
    completedAt: ctx.now().toISOString(),
  })

  ctx.logger.error('generation.job.failed', {
    durationMs,
    errorCategory: errorDetails.category,
    message,
  })

  if (failedJob?.deckId) {
    await persistTerminalAssistantMessage(ctx, failedJob, {
      status: 'failed',
      steps: failedJob.progress.steps,
      deckId: failedJob.deckId,
      error: failedJob.error,
    })
  }
}

async function completeCanceledFromError(
  ctx: JobContext,
  latest: Awaited<ReturnType<JobContext['stores']['jobStore']['getJob']>>,
  durationMs: number,
) {
  const canceledJob = await ctx.stores.jobStore.updateJob(ctx.job.id, {
    status: 'canceled',
    observability: {
      requestId: ctx.requestId,
      durationMs,
      providerMetrics: {
        latencyMs: durationMs,
        model: latest?.model ?? ctx.job.model,
        provider: latest?.provider ?? ctx.job.provider ?? 'unknown',
        errorCategory: 'aborted',
      },
    },
    completedAt: ctx.now().toISOString(),
  })

  ctx.logger.info('generation.job.canceled', { durationMs })

  if (canceledJob?.deckId) {
    await persistTerminalAssistantMessage(ctx, canceledJob, {
      status: 'canceled',
      steps: canceledJob.progress.steps,
      deckId: canceledJob.deckId,
      error: { message: 'Generation was canceled.', code: 'canceled' },
    })
  }
}
