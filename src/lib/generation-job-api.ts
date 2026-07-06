import type {
  GenerationJobApi,
  StartGenerationJobRequest,
} from '../../shared/api/generation-jobs.ts'
import { generationJobResponseSchema } from '../../shared/api/generation-jobs.ts'
import { ApiResponseError, fetchApiJsonOrThrow } from '../../shared/api/fetch.ts'
import type { GenerationJobStatus } from '../../shared/generation-job.ts'

export type { GenerationJobApi, StartGenerationJobRequest }

async function readGenerationJobResponse(response: Response) {
  try {
    const data = await fetchApiJsonOrThrow(response, generationJobResponseSchema, {
      fallbackMessage: 'Could not load the generation job.',
    })
    return data.job
  } catch (error) {
    if (error instanceof ApiResponseError && error.code) {
      throw Object.assign(error, { code: error.code })
    }

    throw error
  }
}

export type StartGenerationJobOptions = StartGenerationJobRequest & {
  signal?: AbortSignal
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
