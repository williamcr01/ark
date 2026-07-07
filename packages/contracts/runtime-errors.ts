import { z } from 'zod'

import { deckIdSchema, withRequestId } from './common.ts'

export const runtimeErrorSeveritySchema = z.enum(['info', 'warning', 'error'])

export type RuntimeErrorSeverity = z.infer<typeof runtimeErrorSeveritySchema>

export const runtimeErrorInputSchema = z.object({
  deckId: deckIdSchema.nullable().optional(),
  versionId: deckIdSchema.nullable().optional(),
  slideIndex: z.number().int().min(0).nullable().optional(),
  runtimeMode: z.string().max(64).nullable().optional(),
  severity: runtimeErrorSeveritySchema.nullable().optional(),
  message: z.string().min(1, 'message is required.'),
  source: z.string().nullable().optional(),
  stack: z.string().nullable().optional(),
  requestId: z.string().nullable().optional(),
})

export type RuntimeErrorInput = z.infer<typeof runtimeErrorInputSchema>

export const runtimeErrorResponseSchema = withRequestId({
  id: z.string().uuid(),
  createdAt: z.string(),
})

export type RuntimeErrorResponse = z.infer<typeof runtimeErrorResponseSchema>
