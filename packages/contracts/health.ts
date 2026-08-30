import { z } from 'zod'

import {
  modelInfoSchema,
  modelUnavailableReasonSchema,
  type ModelInfo,
} from '@ark/ai/model-info.ts'

export { modelInfoSchema, modelUnavailableReasonSchema }
export type { ModelInfo }

import { apiErrorPayloadSchema, providerIdSchema, withRequestId } from './common.ts'

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
