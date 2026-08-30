import { z } from 'zod'

import { providerIdSchema } from './provider-id.ts'
import { reasoningEffortSchema } from './reasoning-effort.ts'

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
