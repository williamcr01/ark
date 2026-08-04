import { Router, type Request, type Response } from 'express'

import {
  deckThumbnailImageQuerySchema,
  deckThumbnailsQuerySchema,
  parseQueryParams,
} from '@ark/contracts'
import { type DeckStore, isValidDeckId } from '../deck-record.ts'
import { getRequestLogger } from '../observability/index.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'
import { thumbnailManifestHash, type ThumbnailService } from '../thumbnails/service.ts'

export function createThumbnailsRouter(deps: {
  deckStore: DeckStore
  thumbnailService: ThumbnailService
}): Router {
  const { deckStore, thumbnailService } = deps
  const router = Router()

  router.get('/api/decks/:id/thumbnails', async (request: Request<{ id: string }>, response) => {
    const id = request.params.id?.trim()
    if (!id || !isValidDeckId(id)) {
      response.status(400).json({ error: 'Invalid deck id.' })
      return
    }
    const parsed = parseQueryParams(deckThumbnailsQuerySchema, {
      documentRevision: request.query.documentRevision,
      waitMs: request.query.waitMs,
    })
    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    try {
      const deck = await deckStore.getDeck(id)
      if (!deck || deck.documentRevision !== parsed.data.documentRevision) {
        response.status(404).json({ error: 'Document revision not found.' })
        return
      }
      const abortController = new AbortController()
      request.on('close', () => abortController.abort())
      const result = await thumbnailService.getStatus({
        deckId: id,
        documentRevision: deck.documentRevision,
        manifestHash: thumbnailManifestHash(deck.html),
        enqueueIfMissing: true,
        html: deck.html,
        waitMs: parsed.data.waitMs,
        signal: abortController.signal,
      })
      getRequestLogger(request).info('thumbnail.status', {
        deckId: id,
        fields: { documentRevision: deck.documentRevision, status: result.status },
      })
      response.json(result)
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  router.get(
    '/api/decks/:id/thumbnails/:documentRevision/:slideFile',
    async (
      request: Request<{ id: string; documentRevision: string; slideFile: string }>,
      response: Response,
    ) => {
      const id = request.params.id?.trim()
      const documentRevision = Number(request.params.documentRevision)
      const match = /^(\d+)\.png$/i.exec(request.params.slideFile?.trim() ?? '')
      if (!id || !isValidDeckId(id) || !Number.isInteger(documentRevision) || !match) {
        response.status(400).json({ error: 'Invalid thumbnail path.' })
        return
      }
      const parsed = parseQueryParams(deckThumbnailImageQuerySchema, { hash: request.query.hash })
      if (!parsed.ok) {
        response.status(404).json({ error: 'Thumbnail not found.' })
        return
      }
      try {
        const deck = await deckStore.getDeck(id)
        if (!deck || deck.documentRevision !== documentRevision) {
          response.status(404).json({ error: 'Thumbnail not found.' })
          return
        }
        const png = await thumbnailService.readPng({
          deckId: id,
          documentRevision,
          manifestHash: thumbnailManifestHash(deck.html),
          slideIndex: Number(match[1]),
          fingerprint: parsed.data.hash,
        })
        if (!png) {
          response.status(404).json({ error: 'Thumbnail not found.' })
          return
        }
        response.setHeader('Content-Type', 'image/png')
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        response.send(png)
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  return router
}
