import { Router, type Request, type Response } from 'express'

import {
  parseRequestBody,
  createDeckRequestSchema,
  deckPatchRequestSchema,
  renameDeckRequestSchema,
  updateDeckRequestSchema,
} from '@ark/contracts'
import { type DeckStore, isValidDeckId } from '../deck-record.ts'
import type { AssetStore } from '../asset-record.ts'
import { resolveArkAssetUrls } from '../asset-resolve.ts'
import { stripDeckScriptsForPreview } from '@ark/deck-core/deck-preview-slides.ts'
import { buildDeckRuntimeManifestFromValidation } from '../deck-manifest.ts'
import { validateDeckHtmlOnServer } from '@ark/deck/validate/timed.ts'
import { getRequestLogger } from '../observability/index.ts'
import { getApiErrorFromUnknown, sendApiError, sendDeckValidationError } from './shared.ts'
import { WorkspaceDocumentConflictError } from '../workspace-store.ts'

export function createDecksRouter(deps: {
  deckStore: DeckStore
  assetStore: AssetStore
  onDocumentPersisted?: (deckId: string, documentRevision: number) => void
  onEditorPatchPersisted?: (deckId: string, documentRevision: number) => void
}): Router {
  const { deckStore, assetStore, onDocumentPersisted, onEditorPatchPersisted } = deps
  const router = Router()

  const notifyDocumentPersisted = (deckId: string, documentRevision: number) =>
    onDocumentPersisted?.(deckId, documentRevision)

  const sendWriteError = (response: Response, error: unknown) => {
    if (error instanceof WorkspaceDocumentConflictError) {
      response.status(409).json({
        error: error.message,
        code: error.code,
        currentDocumentRevision: error.currentDocumentRevision,
      })
      return
    }
    sendApiError(response, 500, getApiErrorFromUnknown(error))
  }

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
      notifyDocumentPersisted(deck.id, deck.documentRevision)
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
      const deck = await deckStore.updateDeck(id, html, { expectedDocumentRevision })

      if (!deck) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }

      notifyDocumentPersisted(deck.id, deck.documentRevision)

      response.json({
        deck,
        validation,
        runtimeManifest,
      })
    } catch (error) {
      sendWriteError(response, error)
    }
  })

  router.post(
    '/api/decks/:id/patch',
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

      const parsedBody = parseRequestBody(deckPatchRequestSchema, {
        expectedDocumentRevision: request.body?.expectedDocumentRevision,
        operations: request.body?.operations,
        activeSlideIndex: request.body?.activeSlideIndex,
      })

      if (!parsedBody.ok) {
        response.status(400).json({
          error: parsedBody.error,
        })
        return
      }

      try {
        const existing = await deckStore.getDeck(id)

        if (!existing) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        const { applyDeckPatches } = await import('@ark/deck/patch/slide-ops.ts')
        const logger = getRequestLogger(request)
        const patched = applyDeckPatches(existing.html, parsedBody.data.operations, {
          activeSlideIndex: parsedBody.data.activeSlideIndex,
          logger,
        })

        if (!patched.ok) {
          response.status(400).json({
            error: patched.error,
            operationIndex: patched.operationIndex,
          })
          return
        }

        // Prefer the live-DOM validation attached by applyDeckPatches so we do
        // not pay a second full JSDOM parse on the editor commit path.
        const validation =
          patched.validation ??
          validateDeckHtmlOnServer(patched.html, {
            logger,
          })

        if (!validation.valid) {
          sendDeckValidationError(response, validation, request)
          return
        }

        const deck = await deckStore.updateDeck(id, patched.html, {
          expectedDocumentRevision: parsedBody.data.expectedDocumentRevision,
        })

        if (!deck) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        if (onEditorPatchPersisted) {
          onEditorPatchPersisted(deck.id, deck.documentRevision)
        } else {
          notifyDocumentPersisted(deck.id, deck.documentRevision)
        }

        response.json({
          deck,
          validation,
          patch: {
            appliedCount: patched.appliedCount,
            changedSlideIndexes: patched.changedSlideIndexes,
            changedElementIds: patched.changedElementIds,
            summary: patched.summary,
            suggestedActiveSlideIndex: patched.suggestedActiveSlideIndex,
          },
        })
      } catch (error) {
        sendWriteError(response, error)
      }
    },
  )

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

  return router
}
