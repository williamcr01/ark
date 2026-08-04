import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertApiContract,
  createDeckResponseSchema,
  deckThumbnailsResponseSchema,
  simpleErrorResponseSchema,
} from '@ark/contracts'
import { createApp } from '../app.ts'
import { createAssetStore } from '../asset-store.ts'
import { createDeckStore } from '../deck-store.ts'
import { createPreviewSessionStore } from '../preview-sessions.ts'
import { createWorkspaceStore, type WorkspaceStore } from '../workspace-store.ts'
import { createThumbnailService } from './service.ts'
import type { ThumbnailService } from './service.ts'
import type { ThumbnailRenderer } from './renderer.ts'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Route Thumb Deck</title></head>
<body>
  <section class="slide"><h1>One</h1></section>
  <section class="slide"><h1>Two</h1></section>
</body>
</html>`

describe('thumbnail API routes', () => {
  let dataDir = ''
  let server: Server | null = null
  let workspaces: WorkspaceStore | null = null
  let thumbnailService: ThumbnailService | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()))
      })
      server = null
    }

    await thumbnailService?.close()
    thumbnailService = null
    workspaces?.close()
    workspaces = null
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
    dataDir = ''
  })

  async function startApi(renderer: ThumbnailRenderer) {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-api-decks-'))
    workspaces = createWorkspaceStore(dataDir)
    const deckStore = createDeckStore(workspaces)
    const assetStore = createAssetStore(workspaces)
    const previewSessionStore = createPreviewSessionStore()
    thumbnailService = createThumbnailService({
      renderer,
      deckStore,
      workspaceStore: workspaces,
      assetStore,
    })
    const app = createApp({
      deckStore,
      workspaceStore: workspaces,
      assetStore,
      previewSessionStore,
      thumbnailService,
    })

    server = app.listen(0)
    await new Promise<void>((resolve) => server?.once('listening', resolve))
    const address = server.address() as AddressInfo
    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      deckStore,
      thumbnailService,
    }
  }

  it('returns pending then ready thumbnails and serves png bytes', async () => {
    let resolveRender: ((value: unknown) => void) | null = null
    const renderGate = new Promise((resolve) => {
      resolveRender = resolve
    })

    const { baseUrl } = await startApi({
      isAvailable: () => true,
      close: async () => undefined,
      render: async (request) => {
        await renderGate
        const slideIndexes = request.slideIndexes ?? [0, 1]
        const values = new Map([
          [0, 'png-one'],
          [1, 'png-two'],
        ])

        return {
          ok: true,
          slides: slideIndexes.map((index) => Buffer.from(values.get(index) ?? `png-${index}`)),
          slideCount: 2,
          width: 480,
          height: 270,
          durationMs: 10,
        }
      },
    })

    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml }),
    })
    const created = await createResponse.json()
    assertApiContract(createDeckResponseSchema, created)
    const documentRevision = created.deck.documentRevision

    const pendingResponse = await fetch(
      `${baseUrl}/api/decks/${created.deck.id}/thumbnails?documentRevision=${documentRevision}`,
    )
    const pending = await pendingResponse.json()
    assertApiContract(deckThumbnailsResponseSchema, pending)
    expect(pending.status).toBe('pending')

    resolveRender?.(null)

    let ready: { status: string; slides: Array<{ url: string }> } | null = null
    await vi.waitFor(
      async () => {
        const readyResponse = await fetch(
          `${baseUrl}/api/decks/${created.deck.id}/thumbnails?documentRevision=${documentRevision}`,
        )
        ready = await readyResponse.json()
        assertApiContract(deckThumbnailsResponseSchema, ready)
        expect(ready.status).toBe('ready')
        expect(ready.slides).toHaveLength(2)
      },
      { timeout: 5_000 },
    )

    const slideUrl = ready!.slides[0]!.url
    const imageResponse = await fetch(`${baseUrl}${slideUrl}`)
    expect(imageResponse.status).toBe(200)
    expect(imageResponse.headers.get('content-type')).toContain('image/png')
    expect(imageResponse.headers.get('cache-control')).toContain('immutable')
    expect(Buffer.from(await imageResponse.arrayBuffer()).toString()).toBe('png-one')

    const slidePath = slideUrl.split('?')[0]
    const currentHash = new URL(`${baseUrl}${slideUrl}`).searchParams.get('hash')!
    const mismatchHash = `${currentHash.slice(0, -1)}${currentHash.endsWith('0') ? '1' : '0'}`
    expect((await fetch(`${baseUrl}${slidePath}?hash=${mismatchHash}`)).status).toBe(404)
    expect((await fetch(`${baseUrl}${slidePath}?hash=abcdef01`)).status).toBe(404)
    expect((await fetch(`${baseUrl}${slidePath}`)).status).toBe(404)
  })

  it('long-polls local renders and serves cached pngs', async () => {
    const { baseUrl, deckStore } = await startApi({
      isAvailable: () => true,
      close: async () => undefined,
      render: async (request) => {
        const slideIndexes = request.slideIndexes ?? [0, 1]
        const values = new Map([
          [0, 'png-one'],
          [1, 'png-two'],
        ])

        return {
          ok: true,
          slides: slideIndexes.map((index) => Buffer.from(values.get(index) ?? `png-${index}`)),
          slideCount: 2,
          width: 480,
          height: 270,
          durationMs: 1,
        }
      },
    })

    const created = await deckStore.createDeck(sampleHtml)
    const documentRevision = created.documentRevision
    const getDeckSpy = vi.spyOn(deckStore, 'getDeck')

    const statusResponse = await fetch(
      `${baseUrl}/api/decks/${created.id}/thumbnails?documentRevision=${documentRevision}&waitMs=500`,
    )
    const status = await statusResponse.json()
    assertApiContract(deckThumbnailsResponseSchema, status)
    expect(status.status).toBe('ready')
    expect(status.slides).toHaveLength(2)
    expect(getDeckSpy).toHaveBeenCalled()

    const imageResponse = await fetch(`${baseUrl}${status.slides[0]!.url}`)
    expect(imageResponse.status).toBe(200)
    expect(Buffer.from(await imageResponse.arrayBuffer()).toString()).toBe('png-one')
    expect(getDeckSpy).toHaveBeenCalled()
  })

  it('returns disabled when the renderer is unavailable', async () => {
    const { baseUrl } = await startApi({
      isAvailable: () => false,
      close: async () => undefined,
      render: async () => ({ ok: false, error: 'disabled', durationMs: 0 }),
    })

    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml }),
    })
    const created = await createResponse.json()
    assertApiContract(createDeckResponseSchema, created)
    const documentRevision = created.deck.documentRevision

    const response = await fetch(
      `${baseUrl}/api/decks/${created.deck.id}/thumbnails?documentRevision=${documentRevision}`,
    )
    const payload = await response.json()
    assertApiContract(deckThumbnailsResponseSchema, payload)
    expect(payload.status).toBe('disabled')
  })

  it('rejects missing document revisions', async () => {
    const { baseUrl } = await startApi({
      isAvailable: () => true,
      close: async () => undefined,
      render: async () => ({
        ok: true,
        slides: [],
        slideCount: 0,
        width: 480,
        height: 270,
        durationMs: 0,
      }),
    })

    const response = await fetch(`${baseUrl}/api/decks/not-a-uuid/thumbnails`)
    expect(response.status).toBe(400)
    assertApiContract(simpleErrorResponseSchema, await response.json())
  })
})
