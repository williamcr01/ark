import type { z } from 'zod'

import { apiErrorPayloadSchema, simpleErrorResponseSchema } from './common.ts'

export class ApiResponseError extends Error {
  readonly code?: string

  constructor(message: string, options?: { code?: string }) {
    super(message)
    this.name = 'ApiResponseError'
    this.code = options?.code
  }
}

const UNREADABLE_RESPONSE = 'The API returned an unreadable response.'

export async function readJsonBody(response: Response): Promise<unknown> {
  return response.json().catch(() => ({ error: UNREADABLE_RESPONSE }))
}

export function parseApiResponse<T extends z.ZodType>(
  schema: T,
  data: unknown,
  options: { fallbackMessage?: string } = {},
): z.infer<T> {
  const parsed = schema.safeParse(data)

  if (!parsed.success) {
    const apiError = apiErrorPayloadSchema.safeParse(data)

    if (apiError.success) {
      throw new ApiResponseError(apiError.data.error, { code: apiError.data.code })
    }

    const simple = simpleErrorResponseSchema.safeParse(data)

    if (simple.success) {
      throw new ApiResponseError(simple.data.error)
    }

    throw new ApiResponseError(options.fallbackMessage ?? UNREADABLE_RESPONSE)
  }

  return parsed.data
}

export async function fetchApiJson<T extends z.ZodType>(
  input: RequestInfo | URL,
  schema: T,
  init?: RequestInit,
): Promise<z.infer<T>> {
  const response = await fetch(input, init)
  const data = await readJsonBody(response)

  if (!response.ok) {
    const simple = simpleErrorResponseSchema.safeParse(data)
    const apiError = apiErrorPayloadSchema.safeParse(data)

    if (apiError.success) {
      throw new ApiResponseError(apiError.data.error, { code: apiError.data.code })
    }

    if (simple.success) {
      throw new ApiResponseError(simple.data.error)
    }

    throw new ApiResponseError(UNREADABLE_RESPONSE)
  }

  return parseApiResponse(schema, data)
}

export async function fetchApiJsonOrThrow<T extends z.ZodType>(
  response: Response,
  schema: T,
  options: { fallbackMessage?: string } = {},
): Promise<z.infer<T>> {
  const data = await readJsonBody(response)

  if (!response.ok) {
    const simple = simpleErrorResponseSchema.safeParse(data)
    const apiError = apiErrorPayloadSchema.safeParse(data)

    if (apiError.success) {
      throw new ApiResponseError(apiError.data.error, { code: apiError.data.code })
    }

    if (simple.success) {
      throw new ApiResponseError(simple.data.error)
    }

    throw new ApiResponseError(options.fallbackMessage ?? UNREADABLE_RESPONSE)
  }

  return parseApiResponse(schema, data, options)
}

/** Assert a JSON payload matches a contract — used in route tests. */
export function assertApiContract<T extends z.ZodType>(
  schema: T,
  data: unknown,
): asserts data is z.infer<T> {
  const parsed = schema.safeParse(data)

  if (!parsed.success) {
    throw new Error(
      `API response does not match contract: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    )
  }
}
