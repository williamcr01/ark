import { Router, type Request, type Response } from 'express'

import {
  parseRequestBody,
  createDeckRequestSchema,
  deckPatchRequestSchema,
  renameDeckRequestSchema,
} from '@ark/contracts'
import { type AssetStore } from '../asset-record.ts'
import { type AssetStorage } from '../asset-storage.ts'
import { computeDeckVersionDiff } from '../deck-diff.ts'
import { buildManualVersionProvenance } from '../deck-provenance.ts'
import { type DeckStore, isValidDeckId } from '../deck-record.ts'
import { buildDeckVersionOptions, mergeDeckVersionOptions } from '../deck-version-payload.ts'
import { validateDeckHtmlOnServer } from '../deck-validate.ts'
import { getRequestLogger } from '../observability/index.ts'
import {
  getApiErrorFromUnknown,
  parseDeckVersionOptions,
  sendApiError,
  sendDeckValidationError,
} from './shared.ts'

export function createDecksRouter(deps: {
  deckStore: DeckStore
  assetStore?: AssetStore
  assetStorage?: AssetStorage
}): Router {
  const { deckStore, assetStore, assetStorage } = deps
  const router = Router()

  const cleanupDeckAssets = async (deckId: string) => {
    if (!assetStore) {
      return
    }

    const removed = await assetStore.deleteAssetsByDeck(deckId)

    if (assetStorage) {
      await Promise.all(removed.map((asset) => assetStorage.delete(asset.storageKey)))
    }
  }

  router.get('/api/decks', async (_request: Request, response: Response) => {
    try {
      const decks = await deckStore.listDecks()

      response.json({ decks })
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

    const { html, ...versionBody } = parsed.data
    const validation = validateDeckHtmlOnServer(html, { logger: getRequestLogger(request) })

    if (!validation.valid) {
      sendDeckValidationError(response, validation, request)
      return
    }

    try {
      const versionOptions = buildDeckVersionOptions(
        html,
        parseDeckVersionOptions(versionBody),
        validation,
      )
      const deck = await deckStore.createDeck(html, versionOptions)
      getRequestLogger(request).info('deck.created', {
        deckId: deck.id,
        statusCode: 201,
      })
      response.status(201).json({
        deck,
        validation,
        runtimeManifest: versionOptions.runtimeManifest ?? null,
      })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  router.put('/api/decks/:id', async (request: Request<{ id: string }>, response: Response) => {
    const id = request.params.id?.trim()
    const parsed = parseRequestBody(createDeckRequestSchema, request.body)

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

    const { html, ...versionBody } = parsed.data
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

      const versionOptions = buildDeckVersionOptions(
        html,
        parseDeckVersionOptions(versionBody),
        validation,
      )
      versionOptions.diff = computeDeckVersionDiff(existing.html, html)

      const deck = await deckStore.updateDeck(id, html, versionOptions)

      if (!deck) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }

      response.json({
        deck,
        validation,
        runtimeManifest: versionOptions.runtimeManifest ?? null,
      })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
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

        const { applyDeckPatches } = await import('../deck-patch.ts')
        const patched = applyDeckPatches(existing.html, parsedBody.data.operations, {
          activeSlideIndex: parsedBody.data.activeSlideIndex,
        })

        if (!patched.ok) {
          response.status(400).json({
            error: patched.error,
            operationIndex: patched.operationIndex,
          })
          return
        }

        const validation = validateDeckHtmlOnServer(patched.html, {
          logger: getRequestLogger(request),
        })

        if (!validation.valid) {
          sendDeckValidationError(response, validation, request)
          return
        }

        const parsedVersionOptions = parseDeckVersionOptions(request.body)
        const versionOptions = mergeDeckVersionOptions(
          patched.html,
          {
            ...parsedVersionOptions,
            summary: parsedVersionOptions.summary ?? patched.summary,
            provenance: buildManualVersionProvenance(parsedBody.data.operations, patched),
            diff: computeDeckVersionDiff(existing.html, patched.html),
          },
          validation,
        )

        const deck = await deckStore.updateDeck(id, patched.html, versionOptions)

        if (!deck) {
          response.status(404).json({ error: 'Deck not found.' })
          return
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
        sendApiError(response, 500, getApiErrorFromUnknown(error))
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

      await cleanupDeckAssets(id)

      response.status(204).send()
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  return router
}
