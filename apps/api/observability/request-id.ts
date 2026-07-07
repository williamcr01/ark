import { randomUUID } from 'node:crypto'

export const REQUEST_ID_HEADER = 'x-request-id'

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value.trim())
}

export function createRequestId() {
  return randomUUID()
}

export function resolveRequestId(headerValue: unknown) {
  if (isValidRequestId(headerValue)) {
    return headerValue.trim()
  }

  return createRequestId()
}

export function attachRequestIdToJsonBody<T extends Record<string, unknown>>(
  body: T,
  requestId: string,
) {
  if ('requestId' in body) {
    return body
  }

  return {
    ...body,
    requestId,
  }
}
