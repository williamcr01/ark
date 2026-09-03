import { Router, type Request, type Response } from 'express'
import { isValidDeckId } from '@ark/storage/records/deck-record.ts'
import { resolveArkAssetUrls } from '@ark/storage/records/asset-resolve.ts'
import { stripDeckScriptsForPreview } from '@ark/deck-preview/preview-slides.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'

import type { DecksRouterDeps } from './decks-helpers.ts'

export function registerDeckReadRoutes(router: Router, deps: DecksRouterDeps) {
  const { deckStore, assetStore } = deps
  router.get('/api/decks', async (_request: Request, response: Response) => {
    try {
      const decks = await deckStore.listDecks()

      response.json({ decks })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  router.get('/api/decks/:id/export', async (request: Request<{ id: string }>, response) => {
    const id = request.params.id?.trim()
    if (!id || !isValidDeckId(id)) {
      response.status(400).json({ error: 'Invalid deck id.' })
      return
    }
    try {
      const deck = await deckStore.getDeck(id)
      if (!deck) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }
      const html = await resolveArkAssetUrls(assetStore, id, deck.html)
      response
        .type('html')
        .send(request.query.sanitized === 'true' ? stripDeckScriptsForPreview(html) : html)
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  router.get('/api/decks/:id', async (request: Request<{ id: string }>, response: Response) => {
    const id = request.params.id?.trim()

    if (!id) {
      response.status(400).json({ error: 'Deck id is required.' })
      return
    }

    if (!isValidDeckId(id)) {
      response.status(400).json({ error: 'Invalid deck id.' })
      return
    }

    try {
      const deck = await deckStore.getDeck(id)

      if (!deck) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }

      response.json({ deck })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })
}
