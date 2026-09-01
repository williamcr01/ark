import { z } from 'zod'

import { providerErrorCodeSchema } from '@ark/ai/provider-error-code.ts'
import {
  DECK_ID_PATTERN,
  deckIdSchema,
  isValidDeckId,
  UUID_V4_PATTERN,
} from '@ark/deck/document/id.ts'
import {
  GENERATION_JOB_ID_PATTERN,
  generationJobIdSchema,
  isValidGenerationJobId,
} from '@ark/chat/generation-job.ts'
import {
  PROVIDER_ENV_KEYS,
  PROVIDER_LABELS,
  providerIdSchema,
  type ProviderId,
} from '@ark/ai/provider-id.ts'
import {
  REASONING_EFFORT_LABELS,
  reasoningEffortSchema,
  type ReasoningEffort,
} from '@ark/ai/reasoning-effort.ts'

export { DECK_ID_PATTERN, deckIdSchema, isValidDeckId, UUID_V4_PATTERN }
export { GENERATION_JOB_ID_PATTERN, generationJobIdSchema, isValidGenerationJobId }
export { PROVIDER_ENV_KEYS, PROVIDER_LABELS, providerIdSchema, reasoningEffortSchema }
export { REASONING_EFFORT_LABELS }
export type { ProviderId, ReasoningEffort }

export const requestIdSchema = z.string().uuid()

export const apiErrorCodeSchema = z.enum([
  ...providerErrorCodeSchema.options,
  'document_conflict',
  'workspace_file_exists',
  'workspace_already_open',
  'pptx_legacy',
  'pptx_encrypted',
  'pptx_invalid',
])

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

export const apiErrorPayloadSchema = z.object({
  error: z.string(),
  code: apiErrorCodeSchema,
})

export type ApiErrorPayload = z.infer<typeof apiErrorPayloadSchema>

export const simpleErrorResponseSchema = z.object({
  error: z.string(),
  requestId: requestIdSchema.optional(),
})

export type SimpleErrorResponse = z.infer<typeof simpleErrorResponseSchema>

export const withRequestId = <T extends z.ZodRawShape>(shape: T) =>
  z.object({
    ...shape,
    requestId: requestIdSchema.optional(),
  })

export function firstZodIssueMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? 'Invalid request.'
}

export function parseRequestBody<T extends z.ZodType>(
  schema: T,
  body: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return { ok: false, error: firstZodIssueMessage(parsed.error) }
  }

  return { ok: true, data: parsed.data }
}

export function parseQueryParams<T extends z.ZodType>(
  schema: T,
  query: Record<string, unknown>,
): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  return parseRequestBody(schema, query)
}
