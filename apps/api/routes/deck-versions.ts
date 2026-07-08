import { Router, type Request, type Response } from 'express'

import { parseRequestBody, rollbackDeckRequestSchema } from '@ark/contracts'
import { computeDeckVersionDiff } from '../deck-diff.ts'
import { buildRollbackVersionProvenance } from '../deck-provenance.ts'
import { type DeckStore, isValidDeckId } from '../deck-record.ts'
import { mergeDeckVersionOptions } from '../deck-version-payload.ts'
import { validateDeckHtmlOnServer } from '../deck-validate.ts'
import { getRequestLogger } from '../observability/index.ts'
import { getApiErrorFromUnknown, sendApiError, sendDeckValidationError } from './shared.ts'

export function createDeckVersionsRouter(deps: { deckStore: DeckStore }): Router {
  const { deckStore } = deps
  const router = Router()

  router.get(
    '/api/decks/:id/versions',
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

      try {
        const versions = await deckStore.listVersions(id)

        if (!versions) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        response.json({ versions })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  router.get(
    '/api/decks/:id/versions/:versionId',
    async (request: Request<{ id: string; versionId: string }>, response: Response) => {
      const id = request.params.id?.trim()
      const versionId = request.params.versionId?.trim()

      if (!id || !versionId) {
        response.status(400).json({ error: 'Deck id and version id are required.' })
        return
      }

      if (!isValidDeckId(id) || !isValidDeckId(versionId)) {
        response.status(400).json({ error: 'Invalid deck id or version id.' })
        return
      }

      try {
        const version = await deckStore.getVersion(id, versionId)

        if (!version) {
          response.status(404).json({ error: 'Version not found.' })
          return
        }

        response.json({ version })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  router.post(
    '/api/decks/:id/rollback',
    async (request: Request<{ id: string }>, response: Response) => {
      const id = request.params.id?.trim()
      const parsed = parseRequestBody(rollbackDeckRequestSchema, request.body)

      if (!id) {
        response.status(400).json({ error: 'Deck id and version id are required.' })
        return
      }

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error })
        return
      }

      const versionId = parsed.data.versionId

      if (!isValidDeckId(id) || !isValidDeckId(versionId)) {
        response.status(400).json({ error: 'Invalid deck id or version id.' })
        return
      }

      try {
        const targetVersion = await deckStore.getVersion(id, versionId)

        if (!targetVersion) {
          response.status(404).json({ error: 'Version not found.' })
          return
        }

        const currentDeck = await deckStore.getDeck(id)

        if (!currentDeck) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        const validation = validateDeckHtmlOnServer(targetVersion.html, {
          logger: getRequestLogger(request),
        })

        if (!validation.valid) {
          sendDeckValidationError(response, validation, request)
          return
        }

        const rollbackOptions = mergeDeckVersionOptions(
          targetVersion.html,
          {
            source: 'rollback',
            summary: `Restored from version ${targetVersion.versionNumber}`,
            validationStatus: targetVersion.validationStatus,
            runtimeManifest: targetVersion.runtimeManifest ?? undefined,
            provenance: buildRollbackVersionProvenance(targetVersion),
            diff: computeDeckVersionDiff(currentDeck.html, targetVersion.html),
          },
          validation,
        )

        const deck = await deckStore.rollbackToVersion(id, versionId, rollbackOptions)

        if (!deck) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        response.json({ deck, validation })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  return router
}
