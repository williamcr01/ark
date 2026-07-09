import { Router, type Request, type Response } from 'express'

import { deckThumbnailsQuerySchema, parseQueryParams } from '@ark/contracts'
import { type DeckStore, isValidDeckId } from '../deck-record.ts'
import { getRequestLogger } from '../observability/index.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'
import { type ThumbnailService } from '../thumbnails/service.ts'

function resolveManifestHash(version: {
  provenance?: { runtimeManifestHash?: string | null } | null
}) {
  return version.provenance?.runtimeManifestHash?.trim() || 'none'
}

export function createThumbnailsRouter(deps: {
  deckStore: DeckStore
  thumbnailService: ThumbnailService
}): Router {
  const { deckStore, thumbnailService } = deps
  const router = Router()

  router.get(
    '/api/decks/:id/thumbnails',
    async (request: Request<{ id: string }>, response: Response) => {
      const id = request.params.id?.trim()

      if (!id) {
        response.status(400).json({ error: 'Deck id is required.' })
        return
      }

      if (!isValidDeckId(id)) {
        response.status(400).json({ error: 'Invalid deck id.' })
        return
      }

      const parsedQuery = parseQueryParams(deckThumbnailsQuerySchema, {
        versionId: typeof request.query.versionId === 'string' ? request.query.versionId : '',
      })

      if (!parsedQuery.ok) {
        response.status(400).json({ error: parsedQuery.error })
        return
      }

      try {
        const version = await deckStore.getVersion(id, parsedQuery.data.versionId)

        if (!version) {
          response.status(404).json({ error: 'Version not found.' })
          return
        }

        const manifestHash = resolveManifestHash(version)
        const status = await thumbnailService.getStatus({
          deckId: id,
          versionId: version.id,
          manifestHash,
          enqueueIfMissing: true,
          html: version.html,
        })

        getRequestLogger(request).info('thumbnail.status', {
          deckId: id,
          fields: {
            versionId: version.id,
            status: status.status,
            slideCount: status.slides.length,
          },
        })

        response.json(status)
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  router.get(
    '/api/decks/:id/thumbnails/:versionId/:slideFile',
    async (
      request: Request<{ id: string; versionId: string; slideFile: string }>,
      response: Response,
    ) => {
      const id = request.params.id?.trim()
      const versionId = request.params.versionId?.trim()
      const slideFile = request.params.slideFile?.trim() ?? ''
      const match = /^(\d+)\.png$/i.exec(slideFile)

      if (!id || !versionId || !match) {
        response.status(400).json({ error: 'Deck id, version id, and slide image are required.' })
        return
      }

      if (!isValidDeckId(id) || !isValidDeckId(versionId)) {
        response.status(400).json({ error: 'Invalid deck id or version id.' })
        return
      }

      const slideIndex = Number(match[1])

      try {
        const version = await deckStore.getVersion(id, versionId)

        if (!version) {
          response.status(404).json({ error: 'Version not found.' })
          return
        }

        const queryHash =
          typeof request.query.hash === 'string' && request.query.hash.trim()
            ? request.query.hash.trim()
            : null
        const manifestHash = resolveManifestHash(version)

        // A supplied hash must match the version's short manifest hash exactly
        // (which is itself 'none' when no manifest hash is recorded). Omitting
        // the hash is rejected so clients cannot bypass the cache key check.
        if (!queryHash || queryHash !== manifestHash.slice(0, 8)) {
          response.status(404).json({ error: 'Thumbnail not found.' })
          return
        }

        const png = await thumbnailService.readPng({
          deckId: id,
          versionId,
          manifestHash,
          slideIndex,
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
