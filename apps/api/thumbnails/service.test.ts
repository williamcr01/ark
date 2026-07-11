import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDeckStore } from '../deck-store.ts'
import { createThumbnailCache } from './cache.ts'
import { THUMBNAIL_QUEUE_MAX_PENDING, THUMBNAIL_STATUS } from './constants.ts'
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

  it('long-polls a local in-flight render and loads html lazily', async () => {
    let renderCount = 0
    let loadHtmlCount = 0
    const { service } = await setup(async () => {
      renderCount += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      return {
        ok: true,
        slides: [Buffer.from('one'), Buffer.from('two')],
        slideCount: 2,
        width: 480,
        height: 270,
        durationMs: 20,
      }
    })

    const status = await service.getStatus({
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: 'a0000000-0000-4000-8000-000000000001',
      manifestHash: 'abc123',
      enqueueIfMissing: true,
      waitMs: 500,
      loadHtml: async () => {
        loadHtmlCount += 1
        return sampleHtml
      },
    })

    expect(status.status).toBe(THUMBNAIL_STATUS.ready)
    expect(status.slides).toHaveLength(2)
    expect(renderCount).toBe(1)
    expect(loadHtmlCount).toBe(1)
  })

  it('returns pending without loading html when another process owns pending work', async () => {
    let loadHtmlCount = 0
    const { service, cache } = await setup(async () => {
      throw new Error('render should not run')
    })
    const key = {
      versionId: 'a0000000-0000-4000-8000-000000000001',
      manifestHash: 'abc123',
    }
    await cache.markPending(key, {
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: key.versionId,
      manifestHash: key.manifestHash,
      slideCount: 0,
      width: 480,
      height: 270,
    })

    const status = await service.getStatus({
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: key.versionId,
      manifestHash: key.manifestHash,
      enqueueIfMissing: true,
      waitMs: 25,
      loadHtml: async () => {
        loadHtmlCount += 1
        return sampleHtml
      },
    })

    expect(status.status).toBe(THUMBNAIL_STATUS.pending)
    expect(loadHtmlCount).toBe(0)
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

  it('retries a failed render after the retry delay and bounds total attempts', async () => {
    let renderCount = 0
    const { service, cache } = await setup(async () => {
      renderCount += 1

      if (renderCount === 1) {
        return { ok: false, error: 'cold start', durationMs: 1 }
      }

      return {
        ok: true,
        slides: [Buffer.from('one'), Buffer.from('two')],
        slideCount: 2,
        width: 480,
        height: 270,
        durationMs: 5,
      }
    })

    const statusInput = {
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: 'a0000000-0000-4000-8000-000000000001',
      manifestHash: 'abc123',
    }

    await service.enqueue({ ...statusInput, html: sampleHtml })

    await vi.waitFor(async () => {
      const status = await service.getStatus(statusInput)
      expect(status.status).toBe(THUMBNAIL_STATUS.failed)
    })

    // Within the retry delay the failure is returned as-is (no re-render).
    const beforeDelay = await service.getStatus({
      ...statusInput,
      enqueueIfMissing: true,
      html: sampleHtml,
    })
    expect(beforeDelay.status).toBe(THUMBNAIL_STATUS.failed)
    expect(renderCount).toBe(1)

    // Age the failure past the retry delay, then poll again.
    const key = { versionId: statusInput.versionId, manifestHash: statusInput.manifestHash }
    const failedMeta = await cache.readMeta(key)
    expect(failedMeta).not.toBeNull()
    await cache.writeMeta(key, {
      ...failedMeta!,
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
    })

    const retrying = await service.getStatus({
      ...statusInput,
      enqueueIfMissing: true,
      html: sampleHtml,
    })
    expect(retrying.status).toBe(THUMBNAIL_STATUS.pending)

    await vi.waitFor(async () => {
      const status = await service.getStatus(statusInput)
      expect(status.status).toBe(THUMBNAIL_STATUS.ready)
      expect(status.slides).toHaveLength(2)
    })
    expect(renderCount).toBe(2)
  })

  it('stops retrying once the attempt budget is exhausted', async () => {
    let renderCount = 0
    const { service, cache } = await setup(async () => {
      renderCount += 1
      return { ok: false, error: `boom ${renderCount}`, durationMs: 1 }
    })

    const statusInput = {
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: 'a0000000-0000-4000-8000-000000000002',
      manifestHash: 'abc123',
    }
    const key = { versionId: statusInput.versionId, manifestHash: statusInput.manifestHash }

    const waitForFailedAttempt = (attempt: number) =>
      vi.waitFor(async () => {
        const meta = await cache.readMeta(key)
        expect(meta?.status).toBe(THUMBNAIL_STATUS.failed)
        expect(meta?.attempts).toBe(attempt)
        expect(renderCount).toBe(attempt)
      })

    const ageFailureAndPoll = async () => {
      const failedMeta = await cache.readMeta(key)
      await cache.writeMeta(key, {
        ...failedMeta!,
        updatedAt: new Date(Date.now() - 60_000).toISOString(),
      })

      return service.getStatus({
        ...statusInput,
        enqueueIfMissing: true,
        html: sampleHtml,
      })
    }

    await service.enqueue({ ...statusInput, html: sampleHtml })
    await waitForFailedAttempt(1)

    await ageFailureAndPoll()
    await waitForFailedAttempt(2)

    await ageFailureAndPoll()
    await waitForFailedAttempt(3)

    // The attempt budget (3) is exhausted: aged or not, no further renders run.
    const exhausted = await ageFailureAndPoll()
    expect(exhausted.status).toBe(THUMBNAIL_STATUS.failed)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(renderCount).toBe(3)
  })

  it('skips new jobs while the queue is saturated and accepts them after it drains', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))

    let releaseGate: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const renderedVersions: string[] = []
    const service = createThumbnailService({
      cache: createThumbnailCache(cacheDir),
      deckStore: createDeckStore(dataDir),
      renderer: {
        isAvailable: () => true,
        close: async () => undefined,
        render: async (request) => {
          await gate
          renderedVersions.push(request.versionId ?? 'unknown')
          return {
            ok: true,
            slides: [Buffer.from('png')],
            slideCount: 1,
            width: 480,
            height: 270,
            durationMs: 1,
          }
        },
      },
    })

    const versionId = (index: number) =>
      `a0000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    const enqueueVersion = (index: number) =>
      service.enqueue({
        deckId: 'b0000000-0000-4000-8000-000000000001',
        versionId: versionId(index),
        html: sampleHtml,
        manifestHash: 'abc123',
      })

    // Fill the queue to its bound (THUMBNAIL_QUEUE_MAX_PENDING = 20).
    for (let index = 0; index < THUMBNAIL_QUEUE_MAX_PENDING; index += 1) {
      await enqueueVersion(index)
    }

    // One more while saturated: skipped, reported as pending.
    const overflow = await enqueueVersion(THUMBNAIL_QUEUE_MAX_PENDING)
    expect(overflow.status).toBe(THUMBNAIL_STATUS.pending)

    releaseGate?.()

    await vi.waitFor(() => {
      expect(renderedVersions).toHaveLength(THUMBNAIL_QUEUE_MAX_PENDING)
    })
    expect(renderedVersions).not.toContain(versionId(THUMBNAIL_QUEUE_MAX_PENDING))

    // Once drained, re-enqueueing the skipped version renders it.
    await enqueueVersion(THUMBNAIL_QUEUE_MAX_PENDING)
    await vi.waitFor(() => {
      expect(renderedVersions).toContain(versionId(THUMBNAIL_QUEUE_MAX_PENDING))
    })
  })

  it('does not load html for a missing render while the queue is saturated', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))

    let releaseGate: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const renderedVersions: string[] = []
    const service = createThumbnailService({
      cache: createThumbnailCache(cacheDir),
      deckStore: createDeckStore(dataDir),
      renderer: {
        isAvailable: () => true,
        close: async () => undefined,
        render: async (request) => {
          await gate
          renderedVersions.push(request.versionId ?? 'unknown')
          return {
            ok: true,
            slides: [Buffer.from('png')],
            slideCount: 1,
            width: 480,
            height: 270,
            durationMs: 1,
          }
        },
      },
    })

    const versionId = (index: number) =>
      `a0000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    for (let index = 0; index < THUMBNAIL_QUEUE_MAX_PENDING; index += 1) {
      await service.enqueue({
        deckId: 'b0000000-0000-4000-8000-000000000001',
        versionId: versionId(index),
        html: sampleHtml,
        manifestHash: 'abc123',
      })
    }

    let loadHtmlCount = 0
    const overflow = await service.getStatus({
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: versionId(THUMBNAIL_QUEUE_MAX_PENDING),
      manifestHash: 'abc123',
      enqueueIfMissing: true,
      waitMs: 25,
      loadHtml: async () => {
        loadHtmlCount += 1
        return sampleHtml
      },
    })

    expect(overflow.status).toBe(THUMBNAIL_STATUS.pending)
    expect(loadHtmlCount).toBe(0)

    releaseGate?.()
    await vi.waitFor(() => {
      expect(renderedVersions).toHaveLength(THUMBNAIL_QUEUE_MAX_PENDING)
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

  it('keeps distinct manifest hashes in separate cache entries and skips re-render when ready', async () => {
    let renderCount = 0
    const { service } = await setup(async () => {
      renderCount += 1
      return {
        ok: true,
        slides: [Buffer.from('one'), Buffer.from('two')],
        slideCount: 2,
        width: 480,
        height: 270,
        durationMs: 5,
      }
    })

    const deckId = 'b0000000-0000-4000-8000-000000000001'
    const versionId = 'a0000000-0000-4000-8000-000000000001'
    const firstHash = 'abcdef0100000000000000000000000000000000000000000000000000000000'
    const secondHash = 'abcdef01ffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

    await service.enqueue({ deckId, versionId, html: sampleHtml, manifestHash: firstHash })
    await vi.waitFor(async () => {
      const ready = await service.getStatus({ deckId, versionId, manifestHash: firstHash })
      expect(ready.status).toBe(THUMBNAIL_STATUS.ready)
    })
    expect(renderCount).toBe(1)

    const stillReady = await service.getStatus({
      deckId,
      versionId,
      manifestHash: firstHash,
      enqueueIfMissing: true,
      html: sampleHtml,
    })
    expect(stillReady.status).toBe(THUMBNAIL_STATUS.ready)
    expect(renderCount).toBe(1)

    await service.enqueue({ deckId, versionId, html: sampleHtml, manifestHash: secondHash })
    await vi.waitFor(async () => {
      const ready = await service.getStatus({ deckId, versionId, manifestHash: secondHash })
      expect(ready.status).toBe(THUMBNAIL_STATUS.ready)
      expect(ready.slides[0]?.url).toContain('hash=')
      expect(ready.slides[0]?.url).not.toBe(stillReady.slides[0]?.url)
    })
    expect(renderCount).toBe(2)
  })

  it('warms thumbnails for a persisted deck version', async () => {
    let renderCount = 0
    const { service, deckStore } = await setup(async () => {
      renderCount += 1
      return {
        ok: true,
        slides: [Buffer.from('one'), Buffer.from('two')],
        slideCount: 2,
        width: 480,
        height: 270,
        durationMs: 5,
      }
    })

    const created = await deckStore.createDeck(sampleHtml, { source: 'upload' })
    const versionId = created.activeVersionId!
    await service.enqueueForDeckVersion(created.id, versionId)

    await vi.waitFor(async () => {
      const version = await deckStore.getVersion(created.id, versionId)
      const manifestHash = version?.provenance?.runtimeManifestHash ?? 'none'
      const status = await service.getStatus({
        deckId: created.id,
        versionId,
        manifestHash,
      })
      expect(status.status).toBe(THUMBNAIL_STATUS.ready)
      expect(status.slides).toHaveLength(2)
    })
    expect(renderCount).toBe(1)
  })
})
