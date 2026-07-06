import express, { Router, type Request, type Response } from 'express'

import { parseRequestBody } from '../../shared/api/common.ts'
import { uploadAssetRequestSchema } from '../../shared/api/assets.ts'
import type { ChatAttachment } from '../../shared/chat.ts'
import { getAssetCategory, isValidAssetId } from '../../shared/assets.ts'
import { type AssetSource, type AssetStore, toAssetMetadata } from '../asset-record.ts'
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
const ASSET_UPLOAD_JSON_LIMIT = '24mb'

export function createAssetsRouter(deps: AssetsRouterDeps): Router {
  const { assetStore, assetStorage, deckStore } = deps
  const router = Router()

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

        const validation = validateAssetUpload({
          filename: parsed.data.filename,
          mediaType: parsed.data.mediaType,
          data: parsed.data.data,
        })

        if (!validation.ok) {
          getRequestLogger(request).warn('asset.upload.rejected', {
            deckId,
            errorCategory: validation.error.code,
            statusCode: 400,
          })
          response
            .status(400)
            .json({ error: validation.error.message, code: validation.error.code })
          return
        }

        const storageKey = createAssetStorageKey()
        await assetStorage.write(storageKey, validation.bytes)

        const record = await assetStore.createAsset({
          deckId,
          chatMessageId: parsed.data.chatMessageId ?? null,
          filename: validation.filename,
          mediaType: validation.mediaType,
          category: getAssetCategory(validation.mediaType),
          byteSize: validation.byteSize,
          checksum: validation.checksum,
          source: (parsed.data.source as AssetSource | undefined) ?? 'upload',
          storageKind: assetStorage.kind,
          storageKey,
        })

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

  router.get('/api/assets/:id', async (request: Request<{ id: string }>, response: Response) => {
    const id = request.params.id?.trim()

    if (!id || !isValidAssetId(id)) {
      response.status(400).json({ error: 'Invalid asset id.' })
      return
    }

    try {
      const record = await assetStore.getAsset(id)

      if (!record) {
        response.status(404).json({ error: 'Asset not found.' })
        return
      }

      const bytes = await assetStorage.read(record.storageKey)

      if (!bytes) {
        response.status(404).json({ error: 'Asset bytes are unavailable.' })
        return
      }

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
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  router.delete('/api/assets/:id', async (request: Request<{ id: string }>, response: Response) => {
    const id = request.params.id?.trim()

    if (!id || !isValidAssetId(id)) {
      response.status(400).json({ error: 'Invalid asset id.' })
      return
    }

    try {
      const record = await assetStore.deleteAsset(id)

      if (!record) {
        response.status(404).json({ error: 'Asset not found.' })
        return
      }

      await assetStorage.delete(record.storageKey)

      getRequestLogger(request).info('asset.deleted', {
        assetId: id,
        deckId: record.deckId,
        statusCode: 204,
      })

      response.status(204).send()
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  return router
}

/**
 * Resolve uploaded asset ids into inline `data:` URL attachments for a
 * generation run. Only assets scoped to the given deck are resolved, keeping
 * chat history lightweight (references) while giving the model the bytes.
 */
export async function resolveAssetAttachments(
  deps: { assetStore: AssetStore; assetStorage: AssetStorage },
  deckId: string | null,
  assetIds: readonly string[],
): Promise<ChatAttachment[]> {
  const attachments: ChatAttachment[] = []
  const seen = new Set<string>()

  for (const rawId of assetIds) {
    const id = rawId.trim()

    if (!isValidAssetId(id) || seen.has(id)) {
      continue
    }

    seen.add(id)

    const record = await deps.assetStore.getAsset(id)

    if (!record) {
      continue
    }

    // Enforce deck scoping: never let one deck pull another deck's assets.
    if (deckId && record.deckId && record.deckId !== deckId) {
      continue
    }

    const bytes = await deps.assetStorage.read(record.storageKey)

    if (!bytes) {
      continue
    }

    const dataUrl = `data:${record.mediaType};base64,${bytes.toString('base64')}`

    attachments.push({
      type: 'file',
      mediaType: record.mediaType,
      url: dataUrl,
      assetId: record.id,
      ...(record.filename ? { filename: record.filename } : {}),
    })
  }

  return attachments
}
