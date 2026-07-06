import { Router, type Request, type Response } from 'express'

import { parseRequestBody } from '../../shared/api/common.ts'
import { startGenerationJobRequestSchema } from '../../shared/api/generation-jobs.ts'
import type { ChatAttachment } from '../../shared/chat.ts'
import { hasAnyConfiguredProvider, missingApiKeyError } from '../credentials.ts'
import { isValidDeckId } from '../deck-record.ts'
import { isValidGenerationJobId } from '../generation-job-record.ts'
import { toGenerationJobResponse, type GenerationJobRunner } from '../generation-job-runner.ts'
import { getRequestId, getRequestLogger } from '../observability/index.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'

export function createGenerationJobsRouter(deps: {
  generationJobs: GenerationJobRunner
  defaultModel: string
  resolveAssetAttachments?: (
    deckId: string | null,
    assetIds: readonly string[],
  ) => Promise<ChatAttachment[]>
}): Router {
  const { generationJobs, defaultModel, resolveAssetAttachments } = deps
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

    let assetAttachments: ChatAttachment[] = []

    if (resolveAssetAttachments && body.assetIds?.length) {
      try {
        assetAttachments = await resolveAssetAttachments(deckId ?? null, body.assetIds)
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
        return
      }
    }

    try {
      const job = await generationJobs.startJob({
        body,
        defaultModel,
        assetAttachments,
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
