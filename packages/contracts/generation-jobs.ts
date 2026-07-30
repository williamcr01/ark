import { z } from 'zod'

import { apiChatMessageSchema, chatMessagePartSchema } from './chat.ts'
import {
  deckIdSchema,
  generationJobIdSchema,
  reasoningEffortSchema,
  UUID_V4_PATTERN,
  withRequestId,
} from './common.ts'
import { deckValidationReportSchema } from './decks.ts'
import {
  editorSelectionContextSchema,
  MAX_SLIDE_CONTEXTS,
  slideContextSchema,
} from './agent-context.ts'

export {
  editorSelectionContextSchema,
  MAX_SLIDE_CONTEXTS,
  slideContextSchema,
  type EditorSelectionContext,
  type SlideContext,
} from './agent-context.ts'

export const generationJobStatusSchema = z.enum([
  'queued',
  'running',
  'canceling',
  'succeeded',
  'failed',
  'canceled',
])

export type GenerationJobStatus = z.infer<typeof generationJobStatusSchema>

export const agentStepSchema = z.object({
  type: z.enum(['text', 'thinking', 'tool-call', 'tool-result']),
  toolName: z.string().optional(),
  summary: z.string(),
  error: z.boolean().optional(),
  durationMs: z.number().int().min(0).optional(),
})

export const generationJobProgressSchema = z.object({
  steps: z.array(agentStepSchema),
  stepCount: z.number().int().min(0),
  assistantText: z.string().nullable().optional(),
  transcriptParts: z.array(chatMessagePartSchema).optional(),
})

export const generationJobErrorSchema = z.object({
  message: z.string(),
  code: z.string().nullable().optional(),
  validation: z.unknown().optional(),
  errorCategory: z.string().nullable().optional(),
})

export const providerTokenUsageSchema = z.object({
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  totalTokens: z.number().int().min(0).optional(),
})

export const providerCallMetricsSchema = z.object({
  latencyMs: z.number(),
  model: z.string(),
  provider: z.string(),
  tokenUsage: providerTokenUsageSchema.nullable().optional(),
  finishReason: z.string().nullable().optional(),
  retryCount: z.number().int().min(0).optional(),
  errorCategory: z.string().nullable().optional(),
})

export const generationJobObservabilitySchema = z.object({
  requestId: z.string().nullable().optional(),
  providerMetrics: providerCallMetricsSchema.nullable().optional(),
  durationMs: z.number().nullable().optional(),
})

/** Wire-format job result — omits full deck HTML returned only in storage. */
export const generationJobApiResultSchema = z.object({
  deckId: deckIdSchema,
  versionId: deckIdSchema,
  validation: deckValidationReportSchema,
  assistantText: z.string(),
})

export type GenerationJobApiResult = z.infer<typeof generationJobApiResultSchema>

/** Wire-format generation job exposed by REST endpoints. */
export const generationJobApiSchema = z.object({
  id: generationJobIdSchema,
  deckId: deckIdSchema.nullable(),
  baseVersionId: deckIdSchema.nullable(),
  editingExistingDeck: z.boolean().optional(),
  status: generationJobStatusSchema,
  model: z.string(),
  provider: z.string().nullable(),
  progress: generationJobProgressSchema,
  observability: generationJobObservabilitySchema.nullable().optional(),
  result: generationJobApiResultSchema.nullable(),
  error: generationJobErrorSchema.nullable(),
  retryOfJobId: generationJobIdSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
})

export type GenerationJobApi = z.infer<typeof generationJobApiSchema>

export const generationJobResponseSchema = withRequestId({
  job: generationJobApiSchema,
})

export type GenerationJobResponse = z.infer<typeof generationJobResponseSchema>

export const startGenerationJobRequestSchema = z.object({
  /** Full visible chat history replayed for this generation run. */
  messages: z.array(apiChatMessageSchema).optional(),
  currentHtml: z.string().nullable().optional(),
  model: z.string().optional(),
  /** Reasoning effort for models that support thinking (Cursor-style levels). */
  reasoningEffort: reasoningEffortSchema.optional(),
  deckId: deckIdSchema.nullable().optional(),
  baseVersionId: deckIdSchema.nullable().optional(),
  /** Current manual-editor selection so the agent can target the selected element. */
  editorSelection: editorSelectionContextSchema.optional(),
  /** Slides the user attached as context for this generation turn. */
  slideContexts: z.array(slideContextSchema).max(MAX_SLIDE_CONTEXTS).optional(),
  /**
   * Deck-scoped uploaded asset ids to resolve into file inputs for the latest
   * user turn. Requires `deckId`. Omitted from job poll responses — clients
   * already know what they sent; the runner stores ids on the job record.
   */
  assetIds: z.array(z.string().regex(UUID_V4_PATTERN, 'Invalid asset id.')).optional(),
})

export type StartGenerationJobRequest = z.infer<typeof startGenerationJobRequestSchema>
