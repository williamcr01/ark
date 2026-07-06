import { Router, type Request, type Response } from 'express'

import { handleDeckAssetRequest } from '../deck-assets.ts'
import { handleRuntimeRoutes } from '../deck-runtimes.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'

export function createRuntimesAndAssetsRouter(): Router {
  const router = Router()

  router.get('/api/deck-assets', async (request: Request, response: Response) => {
    try {
      await handleDeckAssetRequest(request, response)
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  router.use(handleRuntimeRoutes)

  return router
}
