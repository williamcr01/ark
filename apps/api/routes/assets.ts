import express, { Router, type Request, type Response } from 'express'

import { parseRequestBody, uploadAssetRequestSchema, type UploadAssetRequest } from '@ark/contracts'
import {
  buildAssetUrl,
  buildTemporaryAssetUrl,
  getAssetCategory,
  isValidAssetId,
} from '@ark/deck-core/assets.ts'
import {
  type AssetRecord,
  type AssetSource,
  type AssetStore,
  toAssetMetadata,
} from '../asset-record.ts'
import { createAssetStorageKey, type AssetStorage } from '../asset-storage.ts'
import { validateAssetUpload } from '../asset-validate.ts'
import { type DeckStore, isValidDeckId } from '../deck-record.ts'
import { getRequestLogger } from '../observability/index.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'

export type AssetsRouterDeps = {
  assetStore: AssetStore
  assetStorage: AssetStorage
  deckStore: DeckStore
}

// Uploaded bytes travel as base64 (~33% larger than the raw file), so the
// upload body limit must exceed MAX_ASSET_UPLOAD_BYTES plus that overhead. This
// route parses its own body so the global (smaller) JSON limit does not reject
// legitimate max-size uploads before validation runs.
const ASSET_UPLOAD_JSON_LIMIT = '72mb'
const TEMPORARY_ASSET_TTL_MS = 24 * 60 * 60 * 1000

function sendAssetBytes(response: Response, record: AssetRecord, bytes: Buffer) {
  response.setHeader('Content-Type', record.mediaType)
  response.setHeader('Content-Length', String(bytes.byteLength))
  response.setHeader('Cache-Control', 'private, max-age=3600')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  // Assets are Ark-owned but treated as untrusted content: neutralize any
  // active content (e.g. scripted SVG) if a browser opens the URL directly.
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  )
  response.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(record.filename)}"`,
  )
  response.send(bytes)
}

async function getDeckScopedAsset(
  deps: AssetsRouterDeps,
  deckId: string,
  assetId: string,
): Promise<{ record: AssetRecord; bytes: Buffer } | null> {
  const deck = await deps.deckStore.getDeck(deckId)

  if (!deck) {
    return null
  }

  const record = await deps.assetStore.getAsset(assetId)

  if (!record || record.deckId !== deckId) {
    return null
  }

  const bytes = await deps.assetStorage.read(record.storageKey)

  if (!bytes) {
    return null
  }

  return { record, bytes }
}

async function persistUploadedAsset(
  deps: AssetsRouterDeps,
  input: UploadAssetRequest,
  deckId: string | null,
) {
  const validation = validateAssetUpload(input)
  if (!validation.ok) return validation

  const storageKey = createAssetStorageKey()
  await deps.assetStorage.write(storageKey, validation.bytes)

  try {
    const record = await deps.assetStore.createAsset({
      deckId,
      chatMessageId: input.chatMessageId ?? null,
      filename: validation.filename,
      mediaType: validation.mediaType,
      category: getAssetCategory(validation.mediaType),
      byteSize: validation.byteSize,
      checksum: validation.checksum,
      source: (input.source as AssetSource | undefined) ?? 'upload',
      storageKind: deps.assetStorage.kind,
      storageKey,
    })
    return { ok: true as const, record }
  } catch (error) {
    await deps.assetStorage.delete(storageKey)
    throw error
  }
}

async function cleanupExpiredTemporaryAssets(deps: AssetsRouterDeps) {
  const cutoff = new Date(Date.now() - TEMPORARY_ASSET_TTL_MS).toISOString()
  const expired = await deps.assetStore.deleteExpiredUnassignedAssets(cutoff)
  await Promise.all(expired.map((record) => deps.assetStorage.delete(record.storageKey)))
}

export function createAssetsRouter(deps: AssetsRouterDeps): Router {
  const { assetStore, assetStorage, deckStore } = deps
  const router = Router()

  router.post(
    '/api/assets',
    express.json({ limit: ASSET_UPLOAD_JSON_LIMIT }),
    async (request: Request, response: Response) => {
      const parsed = parseRequestBody(uploadAssetRequestSchema, request.body)
      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error })
        return
      }

      try {
        await cleanupExpiredTemporaryAssets(deps)
        const result = await persistUploadedAsset(deps, parsed.data, null)
        if (!result.ok) {
          response.status(400).json({ error: result.error.message, code: result.error.code })
          return
        }
        response.status(201).json({ asset: toAssetMetadata(result.record) })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  router.post(
    '/api/decks/:id/assets',
    express.json({ limit: ASSET_UPLOAD_JSON_LIMIT }),
    async (request: Request<{ id: string }>, response: Response) => {
      const deckId = request.params.id?.trim()

      if (!deckId || !isValidDeckId(deckId)) {
        response.status(400).json({ error: 'Invalid deck id.' })
        return
      }

      const parsed = parseRequestBody(uploadAssetRequestSchema, request.body)

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error })
        return
      }

      try {
        const deck = await deckStore.getDeck(deckId)

        if (!deck) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        const result = await persistUploadedAsset(deps, parsed.data, deckId)

        if (!result.ok) {
          getRequestLogger(request).warn('asset.upload.rejected', {
            deckId,
            errorCategory: result.error.code,
            statusCode: 400,
          })
          response.status(400).json({ error: result.error.message, code: result.error.code })
          return
        }

        const record = result.record

        getRequestLogger(request).info('asset.uploaded', {
          deckId,
          assetId: record.id,
          mediaType: record.mediaType,
          byteSize: record.byteSize,
          statusCode: 201,
        })

        response.status(201).json({ asset: toAssetMetadata(record) })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  router.get(
    '/api/decks/:id/assets',
    async (request: Request<{ id: string }>, response: Response) => {
      const deckId = request.params.id?.trim()

      if (!deckId || !isValidDeckId(deckId)) {
        response.status(400).json({ error: 'Invalid deck id.' })
        return
      }

      try {
        const deck = await deckStore.getDeck(deckId)

        if (!deck) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }

        const assets = await assetStore.listAssetsByDeck(deckId)
        response.json({ assets: assets.map(toAssetMetadata) })
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  router.get(
    '/api/decks/:deckId/assets/:assetId',
    async (request: Request<{ deckId: string; assetId: string }>, response: Response) => {
      const deckId = request.params.deckId?.trim()
      const assetId = request.params.assetId?.trim()

      if (!deckId || !isValidDeckId(deckId)) {
        response.status(400).json({ error: 'Invalid deck id.' })
        return
      }

      if (!assetId || !isValidAssetId(assetId)) {
        response.status(400).json({ error: 'Invalid asset id.' })
        return
      }

      try {
        const scoped = await getDeckScopedAsset(deps, deckId, assetId)

        if (!scoped) {
          response.status(404).json({ error: 'Asset not found.' })
          return
        }

        sendAssetBytes(response, scoped.record, scoped.bytes)
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  router.delete(
    '/api/decks/:deckId/assets/:assetId',
    async (request: Request<{ deckId: string; assetId: string }>, response: Response) => {
      const deckId = request.params.deckId?.trim()
      const assetId = request.params.assetId?.trim()

      if (!deckId || !isValidDeckId(deckId)) {
        response.status(400).json({ error: 'Invalid deck id.' })
        return
      }

      if (!assetId || !isValidAssetId(assetId)) {
        response.status(400).json({ error: 'Invalid asset id.' })
        return
      }

      try {
        const existing = await assetStore.getAsset(assetId)

        if (!existing || existing.deckId !== deckId) {
          response.status(404).json({ error: 'Asset not found.' })
          return
        }

        const references = [buildAssetUrl(deckId, assetId), buildTemporaryAssetUrl(assetId)]
        const versions = await deckStore.listVersions(deckId)
        const versionDetails = await Promise.all(
          (versions ?? []).map((version) => deckStore.getVersion(deckId, version.id)),
        )
        if (
          versionDetails.some(
            (version) =>
              version && references.some((reference) => version.html.includes(reference)),
          )
        ) {
          response.status(409).json({
            error: 'This asset is used by a saved deck version and cannot be deleted.',
            code: 'asset_in_use',
          })
          return
        }

        const record = await assetStore.deleteAsset(assetId)

        if (!record) {
          response.status(404).json({ error: 'Asset not found.' })
          return
        }

        await assetStorage.delete(record.storageKey)

        getRequestLogger(request).info('asset.deleted', {
          assetId,
          deckId,
          statusCode: 204,
        })

        response.status(204).send()
      } catch (error) {
        sendApiError(response, 500, getApiErrorFromUnknown(error))
      }
    },
  )

  return router
}
