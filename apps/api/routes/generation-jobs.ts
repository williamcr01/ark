import { Router, type Request, type Response } from 'express'

import { parseRequestBody, startGenerationJobRequestSchema } from '@ark/contracts'
import { hasAnyConfiguredProvider, missingApiKeyError } from '@ark/ai/credentials.ts'
import { isValidDeckId } from '@ark/storage/records/deck-record.ts'
import { isValidGenerationJobId } from '@ark/storage/records/generation-job-record.ts'
import { toGenerationJobResponse, type GenerationJobRunner } from '../generation-job-runner.ts'
import { getRequestId, getRequestLogger } from '../observability/index.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'

export function createGenerationJobsRouter(deps: {
  generationJobs: GenerationJobRunner
  defaultModel: string
}): Router {
  const { generationJobs, defaultModel } = deps
  const router = Router()

  router.post('/api/generation-jobs', async (request: Request, response: Response) => {
    if (!hasAnyConfiguredProvider()) {
      sendApiError(response, 503, missingApiKeyError())
      return
    }

    const parsed = parseRequestBody(startGenerationJobRequestSchema, request.body)

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    const body = parsed.data
    const deckId = body.deckId?.trim()

    if (deckId && !isValidDeckId(deckId)) {
      response.status(400).json({ error: 'Invalid deck id.' })
      return
    }

    try {
      const job = await generationJobs.startJob({
        body,
        defaultModel,
        requestId: getRequestId(request),
      })

      getRequestLogger(request).info('generation.job.enqueued', {
        jobId: job.id,
        deckId: job.deckId,
        model: job.model,
        statusCode: 202,
      })

      response.status(202).json(toGenerationJobResponse(job))
    } catch (error) {
      const apiError = getApiErrorFromUnknown(error)
      const status = apiError.code === 'provider_error' ? 400 : 500
      sendApiError(response, status, apiError)
    }
  })

  router.get(
    '/api/generation-jobs/:id',
    async (request: Request<{ id: string }>, response: Response) => {
      const id = request.params.id?.trim()

      if (!id || !isValidGenerationJobId(id)) {
        response.status(400).json({ error: 'Invalid generation job id.' })
        return
      }

      try {
        const job = await generationJobs.getJob(id)

        if (!job) {
          response.status(404).json({ error: 'Generation job not found.' })
          return
        }

        response.json(toGenerationJobResponse(job))
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  router.post(
    '/api/generation-jobs/:id/cancel',
    async (request: Request<{ id: string }>, response: Response) => {
      const id = request.params.id?.trim()

      if (!id || !isValidGenerationJobId(id)) {
        response.status(400).json({ error: 'Invalid generation job id.' })
        return
      }

      try {
        const job = await generationJobs.cancelJob(id)

        if (!job) {
          response.status(404).json({ error: 'Generation job not found.' })
          return
        }

        response.json(toGenerationJobResponse(job))
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  router.post(
    '/api/generation-jobs/:id/retry',
    async (request: Request<{ id: string }>, response: Response) => {
      const id = request.params.id?.trim()

      if (!id || !isValidGenerationJobId(id)) {
        response.status(400).json({ error: 'Invalid generation job id.' })
        return
      }

      if (!hasAnyConfiguredProvider()) {
        sendApiError(response, 503, missingApiKeyError())
        return
      }

      try {
        const job = await generationJobs.retryJob(id)

        if (!job) {
          response.status(404).json({ error: 'Generation job cannot be retried.' })
          return
        }

        response.status(202).json(toGenerationJobResponse(job))
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  return router
}
