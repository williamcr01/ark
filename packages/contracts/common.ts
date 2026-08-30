import { z } from 'zod'

import { providerErrorCodeSchema } from '@ark/ai/provider-error-code.ts'
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

export { PROVIDER_ENV_KEYS, PROVIDER_LABELS, providerIdSchema, reasoningEffortSchema }
export { REASONING_EFFORT_LABELS }
export type { ProviderId, ReasoningEffort }

export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const DECK_ID_PATTERN = UUID_V4_PATTERN

export const GENERATION_JOB_ID_PATTERN = UUID_V4_PATTERN

export const deckIdSchema = z.string().regex(UUID_V4_PATTERN, 'Invalid deck id.')

export const generationJobIdSchema = z.string().regex(UUID_V4_PATTERN, 'Invalid generation job id.')

export function isValidDeckId(id: string) {
  return DECK_ID_PATTERN.test(id)
}

export function isValidGenerationJobId(id: string) {
  return GENERATION_JOB_ID_PATTERN.test(id)
}

export const requestIdSchema = z.string().uuid()

export const apiErrorCodeSchema = z.enum([
  ...providerErrorCodeSchema.options,
  'document_conflict',
  'workspace_file_exists',
  'workspace_already_open',
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
