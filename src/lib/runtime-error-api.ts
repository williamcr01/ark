export type ReportRuntimeErrorInput = {
  deckId?: string | null
  versionId?: string | null
  slideIndex?: number | null
  runtimeMode?: string | null
  severity?: 'info' | 'warning' | 'error'
  message: string
  source?: string | null
  stack?: string | null
}

type RuntimeErrorResponse = {
  id?: string
  createdAt?: string
  error?: string
  requestId?: string
}

export async function reportRuntimeError(input: ReportRuntimeErrorInput) {
  const response = await fetch('/api/runtime-errors', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as RuntimeErrorResponse

  if (!response.ok) {
    throw new Error(data.error ?? 'Could not report runtime error.')
  }

  return data
}
