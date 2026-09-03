import { type LanguageModel } from 'ai'

import type { GenerationJob, GenerationJobStatus } from '@ark/chat/generation-job.ts'
import { type GenerationJobResponse } from '@ark/contracts'
import { toGenerationJobApi } from './job-wire.ts'
import { runDeckAgent } from './agent.ts'
import { type DeckStore } from '@ark/storage/records/deck-record.ts'
import { type ChatStore } from '@ark/storage/records/chat-record.ts'
import { type AssetStore } from '@ark/storage/records/asset-record.ts'
import { type GenerationJobStore } from '@ark/storage/records/generation-job-record.ts'
import { createLanguageModel } from '@ark/ai/provider-runtime.ts'
import { assertModelAvailable } from '@ark/ai/models.ts'
import { resolveJobAttachments } from './job/attachments.ts'
import {
  buildRetryJob,
  buildStartJobInput,
  type StartGenerationJobOptions,
} from './job/build-job.ts'
import { claimJob } from './job/claim.ts'
import {
  createJobControllerRegistry,
  type JobControllerRegistry,
} from './job/controller-registry.ts'
import type { JobRunnerDeps, RunJobAgent } from './job/context.ts'
import { completeCanceledAfterRun, failFromAgentResult, handleProcessJobError } from './job/fail.ts'
import { persistJobResult } from './job/persist.ts'
import { runJobAgent } from './job/run.ts'

export type { StartGenerationJobOptions }

export type GenerationJobRunnerOptions = {
  deckStore: DeckStore
  jobStore: GenerationJobStore
  chatStore?: ChatStore | null
  assetStore?: AssetStore | null
  createModel?: typeof createLanguageModel
  assertModelAvailable?: typeof assertModelAvailable
  runAgent?: RunJobAgent
  now?: () => Date
  onDocumentPersisted?: (deckId: string, documentRevision: number) => void
  controllers?: JobControllerRegistry
}

export type GenerationJobRunner = {
  startJob: (options: StartGenerationJobOptions) => Promise<GenerationJob>
  retryJob: (jobId: string) => Promise<GenerationJob | null>
  cancelJob: (jobId: string) => Promise<GenerationJob | null>
  getJob: (jobId: string) => Promise<GenerationJob | null>
}

function isTerminalStatus(status: GenerationJobStatus) {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}

async function processGenerationJob(deps: JobRunnerDeps, jobId: string, requestId: string | null) {
  const ctx = await claimJob(deps, jobId, requestId)

  if (!ctx) {
    return
  }

  try {
    const { model, provider } = deps.createModel(ctx.job.model)
    const attachments = await resolveJobAttachments(ctx)
    const { agentResult, observability } = await runJobAgent(
      ctx,
      model as LanguageModel,
      provider,
      attachments,
    )
    const refreshed = await deps.jobStore.getJob(jobId)

    if (!refreshed || refreshed.status === 'canceling') {
      await completeCanceledAfterRun(ctx, agentResult, observability)
      return
    }

    if (!agentResult.ok) {
      await failFromAgentResult(ctx, agentResult, observability)
      return
    }

    await persistJobResult(ctx, refreshed, agentResult, observability)
  } catch (error) {
    await handleProcessJobError(ctx, error)
  } finally {
    deps.controllers.delete(jobId)
  }
}

async function cancelGenerationJob(deps: JobRunnerDeps, jobId: string) {
  const existing = await deps.jobStore.getJob(jobId)

  if (!existing) {
    return null
  }

  if (isTerminalStatus(existing.status)) {
    return existing
  }

  deps.controllers.abort(jobId)

  if (existing.status === 'queued') {
    return (
      (await deps.jobStore.updateJobIfStatus(jobId, 'queued', {
        status: 'canceled',
        completedAt: deps.now().toISOString(),
      })) ?? (await deps.jobStore.getJob(jobId))
    )
  }

  return deps.jobStore.updateJob(jobId, { status: 'canceling' })
}

export function createGenerationJobRunner({
  deckStore,
  jobStore,
  chatStore = null,
  assetStore = null,
  createModel = createLanguageModel,
  assertModelAvailable: assertAvailable = assertModelAvailable,
  runAgent = runDeckAgent,
  now = () => new Date(),
  onDocumentPersisted,
  controllers: controllersOption,
}: GenerationJobRunnerOptions): GenerationJobRunner {
  const deps: JobRunnerDeps = {
    deckStore,
    jobStore,
    chatStore,
    assetStore,
    createModel,
    assertModelAvailable: assertAvailable,
    runAgent,
    now,
    onDocumentPersisted,
    controllers: controllersOption ?? createJobControllerRegistry(),
  }

  const enqueueJob = (jobId: string, requestId: string | null = null) => {
    void processGenerationJob(deps, jobId, requestId)
  }

  return {
    startJob: async (options) => {
      const job = await jobStore.createJob(await buildStartJobInput(deps, options))
      enqueueJob(job.id, options.requestId ?? null)
      return job
    },
    retryJob: async (jobId) => {
      const built = await buildRetryJob(deps, jobId)
      if (!built) {
        return null
      }
      const job = await jobStore.createJob(built.input)
      enqueueJob(job.id, built.requestId)
      return job
    },
    cancelJob: (jobId) => cancelGenerationJob(deps, jobId),
    getJob: (jobId) => jobStore.getJob(jobId),
  }
}

export function toGenerationJobResponse(job: GenerationJob): GenerationJobResponse {
  return { job: toGenerationJobApi(job) }
}
