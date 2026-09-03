import { Router, type Request, type Response } from 'express'
import { parseRequestBody, renameDeckRequestSchema } from '@ark/contracts'
import { isValidDeckId } from '@ark/storage/records/deck-record.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'

import type { DecksRouterDeps } from './decks-helpers.ts'

export function registerDeckMetaRoutes(router: Router, deps: DecksRouterDeps) {
  const { deckStore } = deps
  router.patch('/api/decks/:id', async (request: Request<{ id: string }>, response: Response) => {
    const id = request.params.id?.trim()

    if (!id) {
      response.status(400).json({ error: 'Deck id is required.' })
      return
    }

    if (!isValidDeckId(id)) {
      response.status(400).json({ error: 'Invalid deck id.' })
      return
    }

    const parsed = parseRequestBody(renameDeckRequestSchema, request.body)

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    try {
      const deck = await deckStore.updateDeckMetadata(id, { title: parsed.data.title })

      if (!deck) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }

      response.json({ deck })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  router.delete('/api/decks/:id', async (request: Request<{ id: string }>, response: Response) => {
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
      const deleted = await deckStore.deleteDeck(id)

      if (!deleted) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }

      response.status(204).send()
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })
}
