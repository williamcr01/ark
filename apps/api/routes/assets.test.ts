import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  assertApiContract,
  assetListResponseSchema,
  simpleErrorResponseSchema,
  uploadAssetResponseSchema,
} from '@ark/contracts'
import { createApp } from '../app.ts'
import { resolveAssetAttachments } from '../asset-resolve.ts'
import { createAssetStore, type AssetStore } from '../asset-store.ts'
import { createDeckStore } from '../deck-store.ts'
import { createWorkspaceStore, type WorkspaceStore } from '../workspace-store.ts'

const sampleHtml = `<!DOCTYPE html><html><head><title>Assets Deck</title></head><body><section class="slide"><h1>Hello</h1></section></body></html>`
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
const pngDataUrl = `data:image/png;base64,${PNG_BYTES.toString('base64')}`

describe('asset API routes', () => {
  let root = ''
  let server: Server
  let baseUrl = ''
  let workspaces: WorkspaceStore
  let assetStore: AssetStore

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-api-assets-'))
    workspaces = createWorkspaceStore(root)
    const deckStore = createDeckStore(workspaces)
    assetStore = createAssetStore(workspaces)
    const app = createApp({ deckStore, workspaceStore: workspaces, assetStore })
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    workspaces.close()
    await rm(root, { recursive: true, force: true })
  })

  async function createDeck() {
    const response = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml }),
    })
    return (await response.json()).deck.id as string
  }

  const upload = (deckId: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/decks/${deckId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('uploads and serves asset bytes from the workspace database', async () => {
    const deckId = await createDeck()
    const response = await upload(deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })
    const payload = await response.json()
    expect(response.status).toBe(201)
    assertApiContract(uploadAssetResponseSchema, payload)
    expect(payload.asset).toMatchObject({
      deckId,
      byteSize: PNG_BYTES.length,
      storageKind: 'sqlite',
    })

    const bytesResponse = await fetch(`${baseUrl}${payload.asset.url}`)
    expect(bytesResponse.status).toBe(200)
    expect(Buffer.from(await bytesResponse.arrayBuffer())).toEqual(PNG_BYTES)
  })

  it('lists assets for their workspace only', async () => {
    const deckId = await createDeck()
    await upload(deckId, { filename: 'logo.png', mediaType: 'image/png', data: pngDataUrl })
    const response = await fetch(`${baseUrl}/api/decks/${deckId}/assets`)
    const payload = await response.json()
    assertApiContract(assetListResponseSchema, payload)
    expect(payload.assets).toEqual([expect.objectContaining({ filename: 'logo.png' })])
  })

  it('rejects unsupported media and suspicious filenames', async () => {
    const deckId = await createDeck()
    expect(
      (
        await upload(deckId, {
          filename: 'app.exe',
          mediaType: 'application/x-msdownload',
          data: Buffer.from('MZ').toString('base64'),
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await upload(deckId, {
          filename: '../../evil.png',
          mediaType: 'image/png',
          data: pngDataUrl,
        })
      ).status,
    ).toBe(400)
  })

  it('returns 404 when uploading to a missing workspace', async () => {
    const response = await upload('00000000-0000-4000-8000-0000000000ff', {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })
    expect(response.status).toBe(404)
    assertApiContract(simpleErrorResponseSchema, await response.json())
  })

  it('deletes unreferenced assets and their blob bytes', async () => {
    const deckId = await createDeck()
    const uploaded = await upload(deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })
    const { asset } = await uploaded.json()
    const response = await fetch(`${baseUrl}/api/decks/${deckId}/assets/${asset.id}`, {
      method: 'DELETE',
    })
    expect(response.status).toBe(204)
    await expect(assetStore.readBytes(deckId, asset.id)).resolves.toBeNull()
  })

  it('refuses to delete assets referenced by the current document', async () => {
    const deckId = await createDeck()
    const uploaded = await upload(deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })
    const { asset } = await uploaded.json()
    const withImage = sampleHtml.replace('</body>', `<img src="ark-asset:${asset.id}"></body>`)
    expect(
      (
        await fetch(`${baseUrl}/api/decks/${deckId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: withImage }),
        })
      ).status,
    ).toBe(200)
    const response = await fetch(`${baseUrl}/api/decks/${deckId}/assets/${asset.id}`, {
      method: 'DELETE',
    })
    expect(response.status).toBe(409)
  })

  it('resolves scoped assets into data URL model attachments', async () => {
    const deckId = await createDeck()
    const uploaded = await upload(deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })
    const { asset } = await uploaded.json()
    const resolved = await resolveAssetAttachments({ assetStore }, deckId, [asset.id], {
      strict: true,
    })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.attachments[0]?.url).toMatch(/^data:image\/png;base64,/)
  })

  it('rejects cross-workspace asset reads and resolution', async () => {
    const deckId = await createDeck()
    const otherDeckId = await createDeck()
    const uploaded = await upload(deckId, {
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })
    const { asset } = await uploaded.json()
    expect((await fetch(`${baseUrl}/api/decks/${otherDeckId}/assets/${asset.id}`)).status).toBe(404)
    await expect(
      resolveAssetAttachments({ assetStore }, otherDeckId, [asset.id], { strict: true }),
    ).resolves.toEqual({ ok: false, assetIds: [asset.id] })
  })
})
