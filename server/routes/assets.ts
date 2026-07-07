import express, { Router, type Request, type Response } from 'express'

import { parseRequestBody } from '../../shared/api/common.ts'
import { uploadAssetRequestSchema } from '../../shared/api/assets.ts'
import type { ChatAttachment } from '../../shared/chat.ts'
import { getAssetCategory, isValidAssetId } from '../../shared/assets.ts'
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
const ASSET_UPLOAD_JSON_LIMIT = '24mb'

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

        let record: AssetRecord

        try {
          record = await assetStore.createAsset({
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
        } catch (error) {
          await assetStorage.delete(storageKey)
          throw error
        }

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

export type ResolveAssetAttachmentsResult =
  | {
      ok: true
      attachments: ChatAttachment[]
      byId: ReadonlyMap<string, ChatAttachment>
    }
  | { ok: false; assetIds: string[] }

export type ResolveAssetAttachmentsOptions = {
  /** When true, missing or cross-deck ids are reported instead of skipped. */
  strict?: boolean
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
  options: ResolveAssetAttachmentsOptions = {},
): Promise<ResolveAssetAttachmentsResult> {
  const empty = { ok: true as const, attachments: [], byId: new Map<string, ChatAttachment>() }

  if (!deckId || !isValidDeckId(deckId) || assetIds.length === 0) {
    return empty
  }

  const attachments: ChatAttachment[] = []
  const byId = new Map<string, ChatAttachment>()
  const seen = new Set<string>()
  const unresolved: string[] = []

  for (const rawId of assetIds) {
    const id = rawId.trim()

    if (!id || seen.has(id)) {
      continue
    }

    seen.add(id)

    if (!isValidAssetId(id)) {
      if (options.strict) {
        unresolved.push(id)
      }

      continue
    }

    const record = await deps.assetStore.getAsset(id)

    if (!record || record.deckId !== deckId) {
      if (options.strict) {
        unresolved.push(id)
      }

      continue
    }

    const bytes = await deps.assetStorage.read(record.storageKey)

    if (!bytes) {
      if (options.strict) {
        unresolved.push(id)
      }

      continue
    }

    const dataUrl = `data:${record.mediaType};base64,${bytes.toString('base64')}`

    const attachment: ChatAttachment = {
      type: 'file',
      mediaType: record.mediaType,
      url: dataUrl,
      assetId: record.id,
      ...(record.filename ? { filename: record.filename } : {}),
    }

    attachments.push(attachment)
    byId.set(record.id, attachment)
  }

  if (options.strict && unresolved.length > 0) {
    return { ok: false, assetIds: unresolved }
  }

  return { ok: true, attachments, byId }
}
