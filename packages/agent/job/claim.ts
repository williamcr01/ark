import { createLogger } from '@ark/telemetry/logger.ts'

import { createJobContext, type JobContext, type JobRunnerDeps } from './context.ts'

export async function claimJob(
  deps: JobRunnerDeps,
  jobId: string,
  requestId: string | null = null,
): Promise<JobContext | null> {
  const claimed = await deps.jobStore.claimQueuedJob(jobId, deps.now().toISOString())

  if (!claimed) {
    return null
  }

  const abortController = new AbortController()
  deps.controllers.set(jobId, abortController)
  const makeLogger = deps.createLogger ?? createLogger
  const logger = makeLogger({
    service: 'ark-generation',
    requestId,
    jobId,
    deckId: claimed.deckId,
  })
  const jobStartedAt = performance.now()

  logger.info('generation.job.started', {
    model: claimed.model,
    provider: claimed.provider,
    status: claimed.status,
  })

  return createJobContext({
    job: claimed,
    deps,
    logger,
    abortController,
    requestId,
    jobStartedAt,
  })
}
