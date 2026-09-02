import { type LanguageModel } from 'ai'

import type { GenerationJobObservability } from '@ark/chat/generation-job.ts'
import { buildOpaquePromptCacheKey } from '@ark/ai/prompt-cache-options.ts'
import type { RunDeckAgentResult } from '../agent.ts'
import type { JobContext } from './context.ts'
import type { JobAttachments } from './attachments.ts'

export type JobAgentRun = {
  agentResult: RunDeckAgentResult
  observability: GenerationJobObservability
}

export async function runJobAgent(
  ctx: JobContext,
  model: LanguageModel,
  provider: string,
  attachments: JobAttachments,
): Promise<JobAgentRun> {
  const currentJob = ctx.job
  const abortController = ctx.abortController
  const jobStartedAt = ctx.jobStartedAt
  const agentResult = await ctx.deps.runAgent({
    model: model as LanguageModel,
    provider,
    modelRef: currentJob.model,
    messages: attachments.modelMessages,
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
    logger: ctx.logger,
    attachmentInspector: attachments.attachmentInspector,
    onStepProgress: async (steps) => {
      const latestStep = steps.at(-1)

      ctx.logger.debug('generation.job.step', {
        stepCount: steps.length,
        latestStepType: latestStep?.type ?? null,
        latestToolName: latestStep?.toolName ?? null,
        elapsedMs: Math.round(performance.now() - jobStartedAt),
      })

      const latest = await ctx.stores.jobStore.getJob(currentJob.id)

      if (!latest || latest.status === 'canceling' || latest.status === 'canceled') {
        abortController.abort()
        return
      }

      await ctx.stores.jobStore.updateJob(currentJob.id, {
        progress: {
          steps,
          stepCount: steps.length,
          assistantText: latest.progress.assistantText ?? null,
        },
      })
    },
  })

  return {
    agentResult,
    observability: {
      requestId: ctx.requestId,
      providerMetrics: agentResult.providerMetrics ?? null,
      durationMs: Math.round(performance.now() - jobStartedAt),
    },
  }
}
