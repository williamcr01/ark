import type { GenerationJob } from '@ark/chat/generation-job.ts'
import { type createLanguageModel } from '@ark/ai/provider-runtime.ts'
import { type assertModelAvailable } from '@ark/ai/models.ts'
import type { Logger, LoggerOptions } from '@ark/telemetry/logger.ts'
import { type DeckStore } from '@ark/storage/records/deck-record.ts'
import { type ChatStore } from '@ark/storage/records/chat-record.ts'
import { type AssetStore } from '@ark/storage/records/asset-record.ts'
import { type GenerationJobStore } from '@ark/storage/records/generation-job-record.ts'
import { type runDeckAgent, type RunDeckAgentResult } from '../agent.ts'
import type { JobControllerRegistry } from './controller-registry.ts'

export type RunJobAgent = (
  options: Parameters<typeof runDeckAgent>[0],
) => Promise<RunDeckAgentResult>

export type JobStores = {
  deckStore: DeckStore
  jobStore: GenerationJobStore
  chatStore: ChatStore | null
  assetStore: AssetStore | null
}

export type JobRuntimeDeps = {
  createModel: typeof createLanguageModel
  assertModelAvailable: typeof assertModelAvailable
  runAgent: RunJobAgent
  now: () => Date
  onDocumentPersisted?: (deckId: string, documentRevision: number) => void
  controllers: JobControllerRegistry
  createLogger?: (options: LoggerOptions) => Logger
}

export type JobRunnerDeps = JobStores & JobRuntimeDeps

export type JobContext = {
  job: GenerationJob
  stores: JobStores
  deps: JobRuntimeDeps
  logger: Logger
  signal: AbortSignal
  abortController: AbortController
  now: () => Date
  requestId: string | null
  jobStartedAt: number
}

export function jobStoresFrom(deps: JobRunnerDeps): JobStores {
  return {
    deckStore: deps.deckStore,
    jobStore: deps.jobStore,
    chatStore: deps.chatStore,
    assetStore: deps.assetStore,
  }
}

export function jobRuntimeFrom(deps: JobRunnerDeps): JobRuntimeDeps {
  return {
    createModel: deps.createModel,
    assertModelAvailable: deps.assertModelAvailable,
    runAgent: deps.runAgent,
    now: deps.now,
    onDocumentPersisted: deps.onDocumentPersisted,
    controllers: deps.controllers,
    createLogger: deps.createLogger,
  }
}

export function createJobContext(input: {
  job: GenerationJob
  deps: JobRunnerDeps
  logger: Logger
  abortController: AbortController
  requestId: string | null
  jobStartedAt: number
}): JobContext {
  return {
    job: input.job,
    stores: jobStoresFrom(input.deps),
    deps: jobRuntimeFrom(input.deps),
    logger: input.logger,
    abortController: input.abortController,
    signal: input.abortController.signal,
    now: input.deps.now,
    requestId: input.requestId,
    jobStartedAt: input.jobStartedAt,
  }
}
