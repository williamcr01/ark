import type { RuntimeErrorInput } from '../../shared/api/runtime-errors.ts'
import { runtimeErrorResponseSchema } from '../../shared/api/runtime-errors.ts'
import { fetchApiJsonOrThrow } from '../../shared/api/fetch.ts'

export type ReportRuntimeErrorInput = RuntimeErrorInput

export async function reportRuntimeError(input: ReportRuntimeErrorInput) {
  const response = await fetch('/api/runtime-errors', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  return fetchApiJsonOrThrow(response, runtimeErrorResponseSchema, {
    fallbackMessage: 'Could not report runtime error.',
  })
}
