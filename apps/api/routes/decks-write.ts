import { Router, type Request, type Response } from 'express'
import { parseRequestBody, createDeckRequestSchema, updateDeckRequestSchema } from '@ark/contracts'
import { isValidDeckId } from '@ark/storage/records/deck-record.ts'
import { buildDeckRuntimeManifestFromValidation } from '@ark/storage/fs/deck-manifest.ts'
import { validateDeckHtmlOnServer } from '@ark/deck-node/validate/timed.ts'
import { getRequestLogger } from '../observability/index.ts'
import { getApiErrorFromUnknown, sendApiError, sendDeckValidationError } from './shared.ts'
import { notifyDocumentPersisted, sendDeckWriteError } from './decks-helpers.ts'

import type { DecksRouterDeps } from './decks-helpers.ts'

export function registerDeckWriteRoutes(router: Router, deps: DecksRouterDeps) {
  const { deckStore } = deps
  router.post('/api/decks', async (request: Request, response: Response) => {
    const parsed = parseRequestBody(createDeckRequestSchema, request.body)

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    const { html, origin } = parsed.data
    const validation = validateDeckHtmlOnServer(html, { logger: getRequestLogger(request) })

    if (!validation.valid) {
      sendDeckValidationError(response, validation, request)
      return
    }

    try {
      const runtimeManifest = buildDeckRuntimeManifestFromValidation(html, validation)
      const deck = await deckStore.createDeck(html, origin ? { origin } : undefined)
      notifyDocumentPersisted(deps, deck.id, deck.documentRevision)
      getRequestLogger(request).info('deck.created', {
        deckId: deck.id,
        statusCode: 201,
      })
      response.status(201).json({
        deck,
        validation,
        runtimeManifest,
      })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  router.put('/api/decks/:id', async (request: Request<{ id: string }>, response: Response) => {
    const id = request.params.id?.trim()
    const parsed = parseRequestBody(updateDeckRequestSchema, request.body)

    if (!id) {
      response.status(400).json({ error: 'Deck id is required.' })
      return
    }

    if (!isValidDeckId(id)) {
      response.status(400).json({ error: 'Invalid deck id.' })
      return
    }

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error })
      return
    }

    const { html, expectedDocumentRevision } = parsed.data
    const validation = validateDeckHtmlOnServer(html, { logger: getRequestLogger(request) })

    if (!validation.valid) {
      sendDeckValidationError(response, validation, request)
      return
    }

    try {
      const existing = await deckStore.getDeck(id)

      if (!existing) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }

      const runtimeManifest = buildDeckRuntimeManifestFromValidation(html, validation)
      const deck = await deckStore.updateDeck(id, html, {
        expectedDocumentRevision,
        historySource: 'editor',
      })

      if (!deck) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }

      notifyDocumentPersisted(deps, deck.id, deck.documentRevision)

      response.json({
        deck,
        validation,
        runtimeManifest,
      })
    } catch (error) {
      sendDeckWriteError(response, error)
    }
  })
}
