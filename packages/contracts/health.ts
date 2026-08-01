import { z } from 'zod'

import {
  apiErrorPayloadSchema,
  providerIdSchema,
  reasoningEffortSchema,
  withRequestId,
} from './common.ts'

export const healthResponseSchema = withRequestId({
  ok: z.literal(true),
  model: z.string(),
  apiKey: z.object({
    configured: z.boolean(),
  }),
  providers: z.record(
    providerIdSchema,
    z.object({
      configured: z.boolean(),
    }),
  ),
  preview: z.object({
    sandboxOrigin: z.string(),
    appOrigin: z.string(),
  }),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

export const modelUnavailableReasonSchema = z.enum(['missing_api_key', 'not_found'])

export const modelInfoSchema = z.object({
  id: z.string(),
  provider: providerIdSchema,
  modelId: z.string(),
  name: z.string().optional(),
  available: z.boolean(),
  unavailableReason: modelUnavailableReasonSchema.optional(),
  /** Supported thinking-effort levels for this model (empty/omitted = no effort control). */
  reasoningEfforts: z.array(reasoningEffortSchema).optional(),
  /** Default effort when the model supports reasoning and the client has no preference. */
  defaultReasoningEffort: reasoningEffortSchema.optional(),
  /** Whether chat attachments / deck assets may be sent to this model. */
  supportsAttachments: z.boolean(),
})

export type ModelInfo = z.infer<typeof modelInfoSchema>

export const modelsResponseSchema = withRequestId({
  defaultModel: z.string(),
  models: z.array(modelInfoSchema),
  warnings: z.array(z.string()),
})

export type ModelsResponse = z.infer<typeof modelsResponseSchema>

export const modelsErrorResponseSchema = apiErrorPayloadSchema.extend({
  requestId: z.string().uuid().optional(),
})

export type ModelsErrorResponse = z.infer<typeof modelsErrorResponseSchema>
