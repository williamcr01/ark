import { Router, type Request, type Response } from 'express'

import { resolveAppOrigin, resolveSandboxOrigin } from '@ark/runtime-registry/sandbox-origin.ts'
import { getProviderStatus, hasAnyConfiguredProvider } from '../credentials.ts'
import { ensureModelInList, fetchAllAvailableModels } from '../models.ts'
import {
  getRequestId,
  getRequestLogger,
  parseRuntimeErrorBody,
  type RuntimeErrorStore,
} from '../observability/index.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'

export function createMiscRouter(deps: {
  defaultModel: string
  runtimeErrorStore: RuntimeErrorStore
}): Router {
  const { defaultModel, runtimeErrorStore } = deps
  const router = Router()

  router.get('/api/health', (_request: Request, response: Response) => {
    const configured = hasAnyConfiguredProvider()

    response.json({
      ok: true,
      model: defaultModel,
      apiKey: {
        configured,
      },
      providers: getProviderStatus(),
      preview: {
        sandboxOrigin: resolveSandboxOrigin(),
        appOrigin: resolveAppOrigin(),
      },
    })
  })

  router.get('/api/models', async (_request: Request, response: Response) => {
    try {
      const { models, warnings } = await fetchAllAvailableModels()
      const modelsWithDefault = ensureModelInList(models, defaultModel)

      response.json({
        defaultModel,
        models: modelsWithDefault,
        warnings,
      })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  router.post('/api/runtime-errors', (request: Request, response: Response) => {
    const parsed = parseRuntimeErrorBody(request.body)

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    const record = runtimeErrorStore.record({
      ...parsed.input,
      requestId: parsed.input.requestId ?? getRequestId(request),
    })

    getRequestLogger(request).warn('runtime.error.reported', {
      runtimeErrorId: record.id,
      deckId: record.deckId,
      versionId: record.versionId,
      slideIndex: record.slideIndex,
      runtimeMode: record.runtimeMode,
      severity: record.severity,
      statusCode: 201,
    })

    response.status(201).json({
      id: record.id,
      createdAt: record.createdAt,
    })
  })

  return router
}
