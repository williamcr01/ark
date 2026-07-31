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
import { createDeckStore } from '../deck-store.ts'
import { createPreviewSessionStore } from '../preview-sessions.ts'
import { createThumbnailCache } from './cache.ts'
import { createThumbnailService } from './service.ts'
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
  let cacheDir = ''
  let server: Server | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()))
      })
      server = null
    }

    await Promise.all([
      dataDir ? rm(dataDir, { recursive: true, force: true }) : undefined,
      cacheDir ? rm(cacheDir, { recursive: true, force: true }) : undefined,
    ])
    dataDir = ''
    cacheDir = ''
  })

  async function startApi(renderer: ThumbnailRenderer) {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-api-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-api-cache-'))
    const deckStore = createDeckStore(dataDir)
    const previewSessionStore = createPreviewSessionStore()
    const thumbnailService = createThumbnailService({
      cache: createThumbnailCache(cacheDir),
      renderer,
      deckStore,
    })
    const app = createApp({
      deckStore,
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
      body: JSON.stringify({ html: sampleHtml, source: 'upload' }),
    })
    const created = await createResponse.json()
    assertApiContract(createDeckResponseSchema, created)
    const versionId = created.deck.activeVersionId!

    const pendingResponse = await fetch(
      `${baseUrl}/api/decks/${created.deck.id}/thumbnails?versionId=${versionId}`,
    )
    const pending = await pendingResponse.json()
    assertApiContract(deckThumbnailsResponseSchema, pending)
    expect(pending.status).toBe('pending')

    resolveRender?.(null)

    await vi.waitFor(async () => {
      const readyResponse = await fetch(
        `${baseUrl}/api/decks/${created.deck.id}/thumbnails?versionId=${versionId}`,
      )
      const ready = await readyResponse.json()
      assertApiContract(deckThumbnailsResponseSchema, ready)
      expect(ready.status).toBe('ready')
      expect(ready.slides).toHaveLength(2)

      const imageResponse = await fetch(`${baseUrl}${ready.slides[0]!.url}`)
      expect(imageResponse.status).toBe(200)
      expect(imageResponse.headers.get('content-type')).toContain('image/png')
      expect(imageResponse.headers.get('cache-control')).toContain('immutable')
      expect(Buffer.from(await imageResponse.arrayBuffer()).toString()).toBe('png-one')

      // A hash param that does not match the cached slide fingerprint exactly is
      // rejected — and so is a missing or truncated hash.
      const slidePath = ready.slides[0]!.url.split('?')[0]
      const currentHash = new URL(`${baseUrl}${ready.slides[0]!.url}`).searchParams.get('hash')!
      const mismatchHash = `${currentHash.slice(0, -1)}${currentHash.endsWith('0') ? '1' : '0'}`
      const mismatchResponse = await fetch(`${baseUrl}${slidePath}?hash=${mismatchHash}`)
      expect(mismatchResponse.status).toBe(404)
      const shortHashResponse = await fetch(`${baseUrl}${slidePath}?hash=abcdef01`)
      expect(shortHashResponse.status).toBe(404)
      const missingHashResponse = await fetch(`${baseUrl}${slidePath}`)
      expect(missingHashResponse.status).toBe(404)
    })
  })

  it('long-polls local renders and avoids full version reads for cached pngs', async () => {
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

    const created = await deckStore.createDeck(sampleHtml, { source: 'upload' })
    const versionId = created.activeVersionId!
    const getVersionSpy = vi.spyOn(deckStore, 'getVersion')

    const statusResponse = await fetch(
      `${baseUrl}/api/decks/${created.id}/thumbnails?versionId=${versionId}&waitMs=500`,
    )
    const status = await statusResponse.json()
    assertApiContract(deckThumbnailsResponseSchema, status)
    expect(status.status).toBe('ready')
    expect(status.slides).toHaveLength(2)
    expect(getVersionSpy).toHaveBeenCalledTimes(1)

    const imageResponse = await fetch(`${baseUrl}${status.slides[0]!.url}`)
    expect(imageResponse.status).toBe(200)
    expect(Buffer.from(await imageResponse.arrayBuffer()).toString()).toBe('png-one')
    expect(getVersionSpy).toHaveBeenCalledTimes(1)
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
      body: JSON.stringify({ html: sampleHtml, source: 'upload' }),
    })
    const created = await createResponse.json()
    assertApiContract(createDeckResponseSchema, created)
    const versionId = created.deck.activeVersionId!

    const response = await fetch(
      `${baseUrl}/api/decks/${created.deck.id}/thumbnails?versionId=${versionId}`,
    )
    const payload = await response.json()
    assertApiContract(deckThumbnailsResponseSchema, payload)
    expect(payload.status).toBe('disabled')
  })

  it('rejects missing version ids', async () => {
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
