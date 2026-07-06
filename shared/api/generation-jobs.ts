import { z } from 'zod'

import { deckIdSchema, generationJobIdSchema, withRequestId } from './common.ts'
import { deckValidationReportSchema } from './decks.ts'

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
  type: z.enum(['text', 'tool-call', 'tool-result']),
  toolName: z.string().optional(),
  summary: z.string(),
  error: z.boolean().optional(),
})

export const generationJobProgressSchema = z.object({
  steps: z.array(agentStepSchema),
  stepCount: z.number().int().min(0),
  assistantText: z.string().nullable().optional(),
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
  messages: z.unknown().optional(),
  currentHtml: z.string().nullable().optional(),
  model: z.string().optional(),
  deckId: deckIdSchema.nullable().optional(),
  baseVersionId: deckIdSchema.nullable().optional(),
})

export type StartGenerationJobRequest = z.infer<typeof startGenerationJobRequestSchema>
