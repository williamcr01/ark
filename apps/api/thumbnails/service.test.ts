import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDeckStore } from '../deck-store.ts'
import { createThumbnailCache } from './cache.ts'
import { THUMBNAIL_STATUS } from './constants.ts'
import { createThumbnailService } from './service.ts'
import type { ThumbnailRenderer, ThumbnailRenderResult } from './renderer.ts'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Thumb Deck</title></head>
<body>
  <section class="slide"><h1>One</h1></section>
  <section class="slide"><h1>Two</h1></section>
</body>
</html>`

function createFakeRenderer(
  renderImpl: (html: string) => Promise<ThumbnailRenderResult>,
): ThumbnailRenderer {
  return {
    isAvailable: () => true,
    render: async (request) => renderImpl(request.html),
    close: async () => undefined,
  }
}

describe('thumbnail service', () => {
  let dataDir = ''
  let cacheDir = ''

  afterEach(async () => {
    await Promise.all([
      dataDir ? rm(dataDir, { recursive: true, force: true }) : undefined,
      cacheDir ? rm(cacheDir, { recursive: true, force: true }) : undefined,
    ])
    dataDir = ''
    cacheDir = ''
  })

  async function setup(renderImpl: (html: string) => Promise<ThumbnailRenderResult>) {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))
    const deckStore = createDeckStore(dataDir)
    const cache = createThumbnailCache(cacheDir)
    const renderer = createFakeRenderer(renderImpl)
    const service = createThumbnailService({ cache, renderer, deckStore })
    return { deckStore, cache, service }
  }

  it('enqueues a render, dedupes concurrent requests, and returns ready urls', async () => {
    let renderCount = 0
    const { service } = await setup(async () => {
      renderCount += 1
      await new Promise((resolve) => setTimeout(resolve, 40))
      return {
        ok: true,
        slides: [Buffer.from('one'), Buffer.from('two')],
        slideCount: 2,
        width: 480,
        height: 270,
        durationMs: 40,
      }
    })

    const first = service.enqueue({
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: 'a0000000-0000-4000-8000-000000000001',
      html: sampleHtml,
      manifestHash: 'abc123',
    })
    const second = service.enqueue({
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: 'a0000000-0000-4000-8000-000000000001',
      html: sampleHtml,
      manifestHash: 'abc123',
    })

    const [firstStatus, secondStatus] = await Promise.all([first, second])
    expect(firstStatus.status).toBe(THUMBNAIL_STATUS.pending)
    expect(secondStatus.status).toBe(THUMBNAIL_STATUS.pending)

    await vi.waitFor(async () => {
      const ready = await service.getStatus({
        deckId: 'b0000000-0000-4000-8000-000000000001',
        versionId: 'a0000000-0000-4000-8000-000000000001',
        manifestHash: 'abc123',
      })
      expect(ready.status).toBe(THUMBNAIL_STATUS.ready)
      expect(ready.slides).toHaveLength(2)
      expect(ready.slides[0]?.url).toContain('/0.png')
    })

    expect(renderCount).toBe(1)

    const png = await service.readPng({
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: 'a0000000-0000-4000-8000-000000000001',
      manifestHash: 'abc123',
      slideIndex: 1,
    })
    expect(png?.toString()).toBe('two')
  })

  it('records failed renders without crashing the queue', async () => {
    const { service } = await setup(async () => ({
      ok: false,
      error: 'boom',
      durationMs: 1,
    }))

    await service.enqueue({
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: 'a0000000-0000-4000-8000-000000000001',
      html: sampleHtml,
      manifestHash: 'abc123',
    })

    await vi.waitFor(async () => {
      const status = await service.getStatus({
        deckId: 'b0000000-0000-4000-8000-000000000001',
        versionId: 'a0000000-0000-4000-8000-000000000001',
        manifestHash: 'abc123',
      })
      expect(status.status).toBe(THUMBNAIL_STATUS.failed)
      expect(status.error).toBe('boom')
    })
  })

  it('returns disabled when the renderer is unavailable', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))
    const service = createThumbnailService({
      cache: createThumbnailCache(cacheDir),
      deckStore: createDeckStore(dataDir),
      renderer: {
        isAvailable: () => false,
        render: async () => ({ ok: false, error: 'disabled', durationMs: 0 }),
        close: async () => undefined,
      },
    })

    const status = await service.getStatus({
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: 'a0000000-0000-4000-8000-000000000001',
      manifestHash: 'abc123',
      enqueueIfMissing: true,
      html: sampleHtml,
    })

    expect(status.status).toBe(THUMBNAIL_STATUS.disabled)
    expect(status.slides).toEqual([])
  })
})
