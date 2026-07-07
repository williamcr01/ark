import type { AgentStep, ApiChatMessage } from './chat.ts'
import { deckValidationReportSchema } from './api/decks.ts'

export type GenerationJobStatus =
  'queued' | 'running' | 'canceling' | 'succeeded' | 'failed' | 'canceled'

export const TERMINAL_GENERATION_JOB_STATUSES = new Set<GenerationJobStatus>([
  'succeeded',
  'failed',
  'canceled',
])

export const ACTIVE_GENERATION_JOB_STATUSES = new Set<GenerationJobStatus>([
  'queued',
  'running',
  'canceling',
])

export type GenerationJobRequest = {
  messages: ApiChatMessage[]
  currentHtml: string
  baseVersionId?: string | null
  editingExistingDeck?: boolean
}

export type GenerationJobProgress = {
  steps: AgentStep[]
  stepCount: number
  assistantText?: string | null
}

export type GenerationJobError = {
  message: string
  code?: string | null
  validation?: unknown
  errorCategory?: string | null
}

export type ProviderTokenUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export type ProviderCallMetrics = {
  latencyMs: number
  model: string
  provider: string
  tokenUsage?: ProviderTokenUsage | null
  finishReason?: string | null
  retryCount?: number
  errorCategory?: string | null
}

export type GenerationJobObservability = {
  requestId?: string | null
  providerMetrics?: ProviderCallMetrics | null
  durationMs?: number | null
}

export type GenerationJobResult = {
  deckId: string
  versionId: string
  html: string
  validation: unknown
  assistantText: string
}

export type GenerationJob = {
  id: string
  deckId: string | null
  baseVersionId: string | null
  chatThreadId?: string | null
  /** Asset ids resolved to bytes at run time — kept out of persisted request messages. */
  assetIds?: string[]
  status: GenerationJobStatus
  model: string
  provider: string | null
  request: GenerationJobRequest
  progress: GenerationJobProgress
  result: GenerationJobResult | null
  error: GenerationJobError | null
  observability?: GenerationJobObservability | null
  retryOfJobId: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

export type GenerationJobSummary = Omit<GenerationJob, 'request' | 'result'> & {
  request?: GenerationJobRequest
  result?: GenerationJobResult | null
}

export type CreateGenerationJobInput = {
  deckId?: string | null
  baseVersionId?: string | null
  chatThreadId?: string | null
  assetIds?: string[]
  model: string
  provider?: string | null
  request: GenerationJobRequest
  retryOfJobId?: string | null
}

export type StartGenerationJobRequest = import('./api/generation-jobs.ts').StartGenerationJobRequest

export type GenerationJobApi = import('./api/generation-jobs.ts').GenerationJobApi

/** Map a persisted generation job to the REST wire shape (no request body or HTML). */
export function toGenerationJobApi(job: GenerationJob): GenerationJobApi {
  return {
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
}

export function isGenerationJobStatus(value: unknown): value is GenerationJobStatus {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'canceling' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'canceled'
  )
}

export function normalizeGenerationJobStatusForStorage(status: GenerationJobStatus) {
  return status === 'canceled' ? 'cancelled' : status
}

export function normalizeGenerationJobStatusFromStorage(status: unknown): GenerationJobStatus {
  if (status === 'cancelled') {
    return 'canceled'
  }

  if (isGenerationJobStatus(status)) {
    return status
  }

  return 'failed'
}
