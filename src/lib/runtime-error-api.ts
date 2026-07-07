import type { RuntimeErrorInput } from '../../shared/api/index.ts'
import { runtimeErrorResponseSchema, fetchApiJsonOrThrow } from '../../shared/api/index.ts'

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
