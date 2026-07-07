import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertApiContract,
  assetListResponseSchema,
  simpleErrorResponseSchema,
  uploadAssetResponseSchema,
} from '../../shared/api/index.ts'
import { createApp } from '../app.ts'
import { createAssetStore } from '../asset-store.ts'
import { createLocalAssetStorage } from '../asset-storage.ts'
import { createDeckStore } from '../deck-store.ts'
import { resolveAssetAttachments } from './assets.ts'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Assets Deck</title>
</head>
<body>
  <section class="slide"><h1>Hello</h1></section>
</body>
</html>`

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
const pngDataUrl = `data:image/png;base64,${PNG_BYTES.toString('base64')}`

describe('asset API routes', () => {
  let root = ''
  let server: Server | null = null
  let assetStore = createAssetStore()
  let assetStorage = createLocalAssetStorage()

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()))
      })
      server = null
    }

    if (root) {
      await rm(root, { recursive: true, force: true })
      root = ''
    }
  })

  async function startApi() {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-api-assets-'))
    const deckStore = createDeckStore(path.join(root, 'decks'))
    assetStore = createAssetStore(path.join(root, 'assets', 'meta'))
    assetStorage = createLocalAssetStorage(path.join(root, 'assets', 'blobs'))
    const app = createApp({ deckStore, assetStore, assetStorage })

    server = app.listen(0)
    await new Promise<void>((resolve) => server?.once('listening', resolve))

    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`

    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml, source: 'upload' }),
    })
    const created = await createResponse.json()

    return { baseUrl, deckId: created.deck.id as string }
  }

  const upload = (baseUrl: string, deckId: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/decks/${deckId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('uploads a valid asset and serves it through an Ark-owned URL', async () => {
    const { baseUrl, deckId } = await startApi()

    const response = await upload(baseUrl, deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })
    const json = await response.json()

    expect(response.status).toBe(201)
    assertApiContract(uploadAssetResponseSchema, json)
    expect(json.asset.url).toBe(`/api/decks/${deckId}/assets/${json.asset.id}`)
    expect(json.asset.byteSize).toBe(PNG_BYTES.length)
    expect(json.asset.category).toBe('image')
    expect(json.asset.checksum).toHaveLength(64)

    const bytesResponse = await fetch(`${baseUrl}${json.asset.url}`)
    expect(bytesResponse.status).toBe(200)
    expect(bytesResponse.headers.get('content-type')).toBe('image/png')
    expect(bytesResponse.headers.get('x-content-type-options')).toBe('nosniff')
    const bytes = Buffer.from(await bytesResponse.arrayBuffer())
    expect(bytes.equals(PNG_BYTES)).toBe(true)
  })

  it('lists assets for a deck', async () => {
    const { baseUrl, deckId } = await startApi()

    await upload(baseUrl, deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })

    const listResponse = await fetch(`${baseUrl}/api/decks/${deckId}/assets`)
    const list = await listResponse.json()

    expect(listResponse.status).toBe(200)
    assertApiContract(assetListResponseSchema, list)
    expect(list.assets).toHaveLength(1)
    expect(list.assets[0].filename).toBe('logo.png')
  })

  it('rejects unsupported MIME types', async () => {
    const { baseUrl, deckId } = await startApi()

    const response = await upload(baseUrl, deckId, {
      filename: 'app.exe',
      mediaType: 'application/x-msdownload',
      data: Buffer.from('MZ').toString('base64'),
    })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('unsupported_media_type')
  })

  it('rejects oversized payloads', async () => {
    const { baseUrl, deckId } = await startApi()
    const huge = Buffer.alloc(11 * 1024 * 1024)
    PNG_BYTES.copy(huge)

    const response = await upload(baseUrl, deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: huge.toString('base64'),
    })

    expect(response.status).toBe(400)
  })

  it('rejects suspicious filenames', async () => {
    const { baseUrl, deckId } = await startApi()

    const response = await upload(baseUrl, deckId, {
      filename: '../../evil.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.code).toBe('suspicious_filename')
  })

  it('returns 404 when uploading to a missing deck', async () => {
    const { baseUrl } = await startApi()

    const response = await upload(baseUrl, '00000000-0000-4000-8000-0000000000ff', {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })

    expect(response.status).toBe(404)
    assertApiContract(simpleErrorResponseSchema, await response.json())
  })

  it('rejects malformed upload payloads', async () => {
    const { baseUrl, deckId } = await startApi()

    const response = await upload(baseUrl, deckId, { filename: 'logo.png' })
    expect(response.status).toBe(400)
  })

  it('deletes an asset and its bytes', async () => {
    const { baseUrl, deckId } = await startApi()
    const uploadResponse = await upload(baseUrl, deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })
    const { asset } = await uploadResponse.json()

    const deleteResponse = await fetch(`${baseUrl}/api/decks/${deckId}/assets/${asset.id}`, {
      method: 'DELETE',
    })
    expect(deleteResponse.status).toBe(204)

    const bytesResponse = await fetch(`${baseUrl}/api/decks/${deckId}/assets/${asset.id}`)
    expect(bytesResponse.status).toBe(404)

    const listResponse = await fetch(`${baseUrl}/api/decks/${deckId}/assets`)
    const list = await listResponse.json()
    expect(list.assets).toHaveLength(0)
  })

  it('cleans up deck assets when the deck is deleted', async () => {
    const { baseUrl, deckId } = await startApi()
    const uploadResponse = await upload(baseUrl, deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })
    const { asset } = await uploadResponse.json()
    const stored = await assetStore.getAsset(asset.id)
    expect(stored).not.toBeNull()

    const deleteDeckResponse = await fetch(`${baseUrl}/api/decks/${deckId}`, { method: 'DELETE' })
    expect(deleteDeckResponse.status).toBe(204)

    expect(await assetStore.getAsset(asset.id)).toBeNull()
    expect(stored && (await assetStorage.read(stored.storageKey))).toBeNull()
  })

  it('resolves asset ids into inline data-url attachments scoped to the deck', async () => {
    const { baseUrl, deckId } = await startApi()
    const uploadResponse = await upload(baseUrl, deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })
    const { asset } = await uploadResponse.json()

    const resolved = await resolveAssetAttachments({ assetStore, assetStorage }, deckId, [
      asset.id,
      '00000000-0000-4000-8000-0000000000aa',
    ])

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) {
      return
    }

    expect(resolved.attachments).toHaveLength(1)
    expect(resolved.attachments[0]).toMatchObject({
      type: 'file',
      mediaType: 'image/png',
      assetId: asset.id,
      filename: 'logo.png',
    })
    expect(resolved.attachments[0].url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('rejects cross-deck asset resolution when deck ids differ', async () => {
    const { baseUrl, deckId } = await startApi()
    const uploadResponse = await upload(baseUrl, deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })
    const { asset } = await uploadResponse.json()

    const otherDeck = 'ffffffff-0000-4000-8000-000000000001'
    const resolved = await resolveAssetAttachments(
      { assetStore, assetStorage },
      otherDeck,
      [asset.id],
      { strict: true },
    )

    expect(resolved).toEqual({ ok: false, assetIds: [asset.id] })
  })

  it('returns no attachments when deck id is missing', async () => {
    const { baseUrl, deckId } = await startApi()
    const uploadResponse = await upload(baseUrl, deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })
    const { asset } = await uploadResponse.json()

    expect(await resolveAssetAttachments({ assetStore, assetStorage }, null, [asset.id])).toEqual({
      ok: true,
      attachments: [],
      byId: new Map(),
    })
  })

  it('reports unresolved asset ids in strict mode', async () => {
    const { deckId } = await startApi()
    const missingId = '00000000-0000-4000-8000-0000000000aa'

    expect(
      await resolveAssetAttachments({ assetStore, assetStorage }, deckId, [missingId], {
        strict: true,
      }),
    ).toEqual({ ok: false, assetIds: [missingId] })
  })

  it('rejects unscoped asset fetch from another deck', async () => {
    const { baseUrl, deckId } = await startApi()
    const uploadResponse = await upload(baseUrl, deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })
    const { asset } = await uploadResponse.json()

    const otherDeck = 'ffffffff-0000-4000-8000-000000000001'
    const bytesResponse = await fetch(`${baseUrl}/api/decks/${otherDeck}/assets/${asset.id}`)
    expect(bytesResponse.status).toBe(404)
  })
})
