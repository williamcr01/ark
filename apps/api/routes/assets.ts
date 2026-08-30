import express, { Router, type Request, type Response } from 'express'

import { parseRequestBody, uploadAssetRequestSchema } from '@ark/contracts'
import { getAssetCategory, isValidAssetId } from '@ark/deck/document/assets.ts'
import { type AssetSource, type AssetStore, toAssetMetadata } from '../asset-record.ts'
import { validateAssetUpload } from '../asset-validate.ts'
import { type DeckStore, isValidDeckId } from '../deck-record.ts'
import { getRequestLogger } from '../observability/index.ts'
import { getApiErrorFromUnknown, sendApiError } from './shared.ts'

export type AssetsRouterDeps = { assetStore: AssetStore; deckStore: DeckStore }
const ASSET_UPLOAD_JSON_LIMIT = '72mb'

function sendAssetBytes(
  response: Response,
  record: Awaited<ReturnType<AssetStore['getAsset']>> & {},
  bytes: Buffer,
) {
  response.setHeader('Content-Type', record.mediaType)
  response.setHeader('Content-Length', String(bytes.byteLength))
  response.setHeader('Cache-Control', 'private, max-age=3600')
  response.setHeader('X-Content-Type-Options', 'nosniff')
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

export function createAssetsRouter({ assetStore, deckStore }: AssetsRouterDeps): Router {
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
        if (!(await deckStore.getDeck(deckId))) {
          response.status(404).json({ error: 'Deck not found.' })
          return
        }
        const validation = validateAssetUpload(parsed.data)
        if (!validation.ok) {
          response
            .status(400)
            .json({ error: validation.error.message, code: validation.error.code })
          return
        }
        const record = await assetStore.createAsset({
          deckId,
          chatMessageId: parsed.data.chatMessageId ?? null,
          filename: validation.filename,
          mediaType: validation.mediaType,
          category: getAssetCategory(validation.mediaType),
          source: (parsed.data.source as AssetSource | undefined) ?? 'upload',
          bytes: validation.bytes,
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

  router.get('/api/decks/:id/assets', async (request: Request<{ id: string }>, response) => {
    const deckId = request.params.id?.trim()
    if (!deckId || !isValidDeckId(deckId)) {
      response.status(400).json({ error: 'Invalid deck id.' })
      return
    }
    try {
      if (!(await deckStore.getDeck(deckId))) {
        response.status(404).json({ error: 'Deck not found.' })
        return
      }
      response.json({ assets: (await assetStore.listAssetsByDeck(deckId)).map(toAssetMetadata) })
    } catch (error) {
      sendApiError(response, 500, getApiErrorFromUnknown(error))
    }
  })

  router.get(
    '/api/decks/:deckId/assets/:assetId',
    async (request: Request<{ deckId: string; assetId: string }>, response) => {
      const { deckId, assetId } = request.params
      if (!isValidDeckId(deckId) || !isValidAssetId(assetId)) {
        response.status(400).json({ error: 'Invalid deck or asset id.' })
        return
      }
      const record = await assetStore.getAsset(deckId, assetId)
      const bytes = record ? await assetStore.readBytes(deckId, assetId) : null
      if (!record || !bytes) {
        response.status(404).json({ error: 'Asset not found.' })
        return
      }
      sendAssetBytes(response, record, bytes)
    },
  )

  router.delete(
    '/api/decks/:deckId/assets/:assetId',
    async (request: Request<{ deckId: string; assetId: string }>, response) => {
      const { deckId, assetId } = request.params
      if (!isValidDeckId(deckId) || !isValidAssetId(assetId)) {
        response.status(400).json({ error: 'Invalid deck or asset id.' })
        return
      }
      const existing = await assetStore.getAsset(deckId, assetId)
      if (!existing) {
        response.status(404).json({ error: 'Asset not found.' })
        return
      }
      const deleted = await assetStore.deleteAsset(deckId, assetId)
      if (!deleted) {
        response.status(409).json({ error: 'This asset is in use.', code: 'asset_in_use' })
        return
      }
      response.status(204).send()
    },
  )

  return router
}
