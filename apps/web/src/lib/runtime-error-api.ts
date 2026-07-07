import type { RuntimeErrorInput } from '@ark/contracts'
import { runtimeErrorResponseSchema, fetchApiJsonOrThrow } from '@ark/contracts'

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
