import { z } from 'zod'

import { UUID_V4_PATTERN } from '@ark/deck/document/id.ts'
import type { ProviderTokenUsage } from '@ark/ai/provider-token-usage.ts'
import type { AgentStep, ChatMessagePart } from './messages.ts'
import type { ApiChatMessage } from './api-projection.ts'
import type { EditorSelectionContext, SlideContext } from './context.ts'
import type { DeckOrigin } from '@ark/deck/document/origin.ts'

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

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type GenerationJobRequest = {
  messages: ApiChatMessage[]
  currentHtml: string
  baseDocumentRevision?: number | null
  editingExistingDeck?: boolean
  /** Resolved server-side from the deck record; `blank` starts a new-deck flow. */
  deckOrigin?: DeckOrigin | null
  /** Manual-editor selection captured when the request was submitted (issue #83). */
  editorSelection?: EditorSelectionContext
  /** Full same-slide editor selection set captured with the request (issue #248). */
  editorSelections?: EditorSelectionContext[]
  /** Slides the user attached as context when the request was submitted. */
  slideContexts?: SlideContext[]
  /** Reasoning effort captured when the request was submitted. */
  reasoningEffort?: ReasoningEffort
}

export type GenerationJobProgress = {
  steps: AgentStep[]
  stepCount: number
  assistantText?: string | null
  /** Full assistant transcript for terminal turns that need tool inputs (e.g. ask_user). */
  transcriptParts?: ChatMessagePart[]
}

export type GenerationJobError = {
  message: string
  code?: string | null
  validation?: unknown
  errorCategory?: string | null
}

/** Auth / key codes that always mean a model-provider failure. */
const MODEL_GENERATION_ERROR_CODES = new Set(['missing_api_key', 'invalid_api_key'])

/**
 * Provider-call categories from job runs. Do not treat bare `code: 'provider_error'`
 * as a model failure — job-creation validation also uses that API code.
 */
const MODEL_GENERATION_ERROR_CATEGORIES = new Set([
  'missing_api_key',
  'invalid_api_key',
  'rate_limit',
  'context_length',
  'content_filter',
  'timeout',
  'network',
  'provider_error',
])

export function isModelGenerationError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const candidate = error as { code?: unknown; errorCategory?: unknown }
  return (
    (typeof candidate.code === 'string' && MODEL_GENERATION_ERROR_CODES.has(candidate.code)) ||
    (typeof candidate.errorCategory === 'string' &&
      MODEL_GENERATION_ERROR_CATEGORIES.has(candidate.errorCategory))
  )
}

export function formatModelGenerationFailure(message: string) {
  return `The model failed to generate the deck. ${message.trim() || 'Generation failed.'}`
}

export type { ProviderTokenUsage }

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
  documentRevision: number
  html: string
  validation: unknown
  assistantText: string
}

export type GenerationJob = {
  id: string
  deckId: string | null
  baseDocumentRevision: number | null
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
  baseDocumentRevision?: number | null
  chatThreadId?: string | null
  assetIds?: string[]
  model: string
  provider?: string | null
  request: GenerationJobRequest
  retryOfJobId?: string | null
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

export const GENERATION_JOB_ID_PATTERN = UUID_V4_PATTERN

export const generationJobIdSchema = z.string().regex(UUID_V4_PATTERN, 'Invalid generation job id.')

export function isValidGenerationJobId(id: string) {
  return GENERATION_JOB_ID_PATTERN.test(id)
}
