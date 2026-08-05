import { z } from 'zod'

import { deckIdSchema, withRequestId } from './common.ts'

export const runtimeErrorSeveritySchema = z.enum(['info', 'warning', 'error'])

export type RuntimeErrorSeverity = z.infer<typeof runtimeErrorSeveritySchema>

export const runtimeErrorRepairContextSchema = z.object({
  errorSummary: z.string().max(500),
  affectedSlideIndex: z.number().int().min(0).nullable(),
  runtime: z.object({
    mode: z.string().max(64).nullable(),
    previewMode: z.enum(['css-only', 'full-js']).nullable(),
    approvedRuntime: z
      .object({
        id: z.string().max(64),
        version: z.string().max(64),
      })
      .nullable(),
  }),
  validation: z.object({
    status: z.enum(['unknown', 'valid', 'invalid']),
    errors: z.number().int().min(0).max(10_000),
    warnings: z.number().int().min(0).max(10_000),
  }),
  relatedJobId: deckIdSchema.nullable(),
  documentRevision: z.number().int().min(1).nullable(),
})

export type RuntimeErrorRepairContext = z.infer<typeof runtimeErrorRepairContextSchema>

export const runtimeErrorInputSchema = z.object({
  deckId: deckIdSchema.nullable().optional(),
  documentRevision: z.number().int().min(1).nullable().optional(),
  slideIndex: z.number().int().min(0).nullable().optional(),
  runtimeMode: z.string().max(64).nullable().optional(),
  severity: runtimeErrorSeveritySchema.nullable().optional(),
  message: z.string().min(1, 'message is required.'),
  source: z.string().nullable().optional(),
  stack: z.string().nullable().optional(),
  requestId: z.string().nullable().optional(),
  repairContext: runtimeErrorRepairContextSchema.optional(),
})

export type RuntimeErrorInput = z.infer<typeof runtimeErrorInputSchema>

export const runtimeErrorResponseSchema = withRequestId({
  id: z.string().uuid(),
  createdAt: z.string(),
})

export type RuntimeErrorResponse = z.infer<typeof runtimeErrorResponseSchema>
