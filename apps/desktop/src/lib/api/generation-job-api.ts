import {
  generationJobResponseSchema,
  fetchApiJsonOrThrow,
  type EditorSelectionContext,
  type GenerationJobApi,
  type StartGenerationJobRequest,
} from '@ark/contracts'
import type { GenerationJobStatus } from '@ark/chat/generation-job.ts'

export type { GenerationJobApi, StartGenerationJobRequest }

async function readGenerationJobResponse(response: Response) {
  const data = await fetchApiJsonOrThrow(response, generationJobResponseSchema, {
    fallbackMessage: 'Could not load the generation job.',
  })
  return data.job
}

export type StartGenerationJobOptions = StartGenerationJobRequest & {
  signal?: AbortSignal
  /**
   * Full same-slide editor selection set (#248 / #302). Extra until that
   * contract lands on main; JSON still forwards the field to the API.
   */
  editorSelections?: EditorSelectionContext[]
}

export async function startGenerationJob(body: StartGenerationJobOptions) {
  const { signal, ...requestBody } = body
  const response = await fetch('/api/generation-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal,
  })

  return readGenerationJobResponse(response)
}

export async function fetchGenerationJob(jobId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/generation-jobs/${encodeURIComponent(jobId)}`, { signal })
  return readGenerationJobResponse(response)
}

export async function cancelGenerationJob(jobId: string) {
  const response = await fetch(`/api/generation-jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  })

  return readGenerationJobResponse(response)
}

export async function retryGenerationJob(jobId: string) {
  const response = await fetch(`/api/generation-jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
  })

  return readGenerationJobResponse(response)
}

export function isActiveGenerationJobStatus(status: GenerationJobStatus) {
  return status === 'queued' || status === 'running' || status === 'canceling'
}

export function isFailedGenerationJobStatus(status: GenerationJobStatus) {
  return status === 'failed' || status === 'canceled'
}
