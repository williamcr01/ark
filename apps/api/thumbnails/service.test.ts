import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDeckStore } from '../deck-store.ts'
import type { Logger, LogFields, LogLevel } from '../observability/logger.ts'
import { buildThumbnailCacheKey, createThumbnailCache } from './cache.ts'
import { THUMBNAIL_QUEUE_MAX_PENDING, THUMBNAIL_STATUS } from './constants.ts'
import { createThumbnailService } from './service.ts'
import type {
  ThumbnailRenderer,
  ThumbnailRenderRequest,
  ThumbnailRenderResult,
} from './renderer.ts'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Thumb Deck</title></head>
<body>
  <section class="slide"><h1>One</h1></section>
  <section class="slide"><h1>Two</h1></section>
</body>
</html>`

/**
 * Saturation / eviction coverage uses a small injectable bound so tests exercise
 * the same queue policy without creating 20 decks and draining them serially.
 * Production still defaults to THUMBNAIL_QUEUE_MAX_PENDING.
 */
const TEST_QUEUE_MAX_PENDING = 3
/** Drain waits for a saturated test queue (serial jobs + cache I/O) under CI load. */
const QUEUE_DRAIN_WAIT_MS = 5_000

function renderRequestedSlides(
  request: ThumbnailRenderRequest,
  values: Record<number, string> = { 0: 'one', 1: 'two' },
): ThumbnailRenderResult {
  const slideIndexes = request.slideIndexes ?? [0, 1]

  return {
    ok: true,
    slides: slideIndexes.map((index) => Buffer.from(values[index] ?? `slide-${index}`)),
    slideCount: 2,
    width: 480,
    height: 270,
    durationMs: 5,
  }
}

function createFakeRenderer(
  renderImpl: (request: ThumbnailRenderRequest) => Promise<ThumbnailRenderResult>,
): ThumbnailRenderer {
  return {
    isAvailable: () => true,
    render: async (request) => renderImpl(request),
    close: async () => undefined,
  }
}

type CapturedLogEntry = {
  level: LogLevel
  event: string
  fields: LogFields
}

function createTestLogger(entries: CapturedLogEntry[]): Logger {
  const log = (level: LogLevel, event: string, fields: LogFields = {}) => {
    entries.push({ level, event, fields })
  }

  return {
    log,
    debug: (event, fields) => log('debug', event, fields),
    info: (event, fields) => log('info', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    error: (event, fields) => log('error', event, fields),
  }
}

describe('thumbnail service', () => {
  it('keeps the production queue bound at the documented default', () => {
    expect(THUMBNAIL_QUEUE_MAX_PENDING).toBe(20)
  })

  let dataDir = ''
  let cacheDir = ''
  const openServices: Array<{ close: () => Promise<void> }> = []

  async function removeTempDir(dir: string) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true })
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code

        if (code !== 'ENOTEMPTY' && code !== 'EBUSY') {
          throw error
        }

        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
      }
    }

    await rm(dir, { recursive: true, force: true })
  }

  afterEach(async () => {
    await Promise.all(openServices.splice(0).map((service) => service.close()))
    await Promise.all([
      dataDir ? removeTempDir(dataDir) : undefined,
      cacheDir ? removeTempDir(cacheDir) : undefined,
    ])
    dataDir = ''
    cacheDir = ''
  })

  async function setup(
    renderImpl: (request: ThumbnailRenderRequest) => Promise<ThumbnailRenderResult>,
    serviceOptions: { logger?: Logger; queueConcurrency?: number } = {},
  ) {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))
    const deckStore = createDeckStore(dataDir)
    const cache = createThumbnailCache(cacheDir)
    const renderer = createFakeRenderer(renderImpl)
    const service = createThumbnailService({ cache, renderer, deckStore, ...serviceOptions })
    openServices.push(service)
    return { deckStore, cache, service }
  }

  function trackService<T extends { close: () => Promise<void> }>(service: T): T {
    openServices.push(service)
    return service
  }

  it('enqueues a render, dedupes concurrent requests, and returns ready urls', async () => {
    let renderCount = 0
    let releaseRender!: () => void
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve
    })
    const { service } = await setup(async () => {
      renderCount += 1
      await renderGate
      return {
        ok: true,
        slides: [Buffer.from('one'), Buffer.from('two')],
        slideCount: 2,
        width: 480,
        height: 270,
        durationMs: 1,
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
    releaseRender()

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

  it('reuses unchanged slide blobs across versions and renders only misses', async () => {
    const renderRequests: number[][] = []
    const { service, cache } = await setup(async (request) => {
      const slideIndexes = request.slideIndexes ?? [0, 1]
      renderRequests.push(slideIndexes)

      return {
        ok: true,
        slides: slideIndexes.map((index) =>
          Buffer.from(`render-${renderRequests.length}-${index}`),
        ),
        slideCount: 2,
        width: 480,
        height: 270,
        durationMs: 5,
      }
    })

    const deckId = 'b0000000-0000-4000-8000-000000000001'
    const manifestHash = 'abc123'
    const firstVersionId = 'a0000000-0000-4000-8000-000000000001'
    const secondVersionId = 'a0000000-0000-4000-8000-000000000002'
    const editedHtml = sampleHtml.replace('<h1>Two</h1>', '<h1>Two edited</h1>')

    await service.enqueue({ deckId, versionId: firstVersionId, html: sampleHtml, manifestHash })
    await vi.waitFor(async () => {
      const ready = await service.getStatus({ deckId, versionId: firstVersionId, manifestHash })
      expect(ready.status).toBe(THUMBNAIL_STATUS.ready)
    })

    await service.enqueue({ deckId, versionId: secondVersionId, html: editedHtml, manifestHash })
    await vi.waitFor(async () => {
      const ready = await service.getStatus({ deckId, versionId: secondVersionId, manifestHash })
      expect(ready.status).toBe(THUMBNAIL_STATUS.ready)
    })

    expect(renderRequests).toEqual([[0, 1], [1]])

    const firstMeta = await cache.readMeta({ versionId: firstVersionId, manifestHash })
    const secondMeta = await cache.readMeta({ versionId: secondVersionId, manifestHash })
    expect(secondMeta?.slideFingerprints?.[0]).toBe(firstMeta?.slideFingerprints?.[0])
    expect(secondMeta?.slideFingerprints?.[1]).not.toBe(firstMeta?.slideFingerprints?.[1])

    await expect(
      service.readPng({ deckId, versionId: secondVersionId, manifestHash, slideIndex: 0 }),
    ).resolves.toEqual(Buffer.from('render-1-0'))
    await expect(
      service.readPng({ deckId, versionId: secondVersionId, manifestHash, slideIndex: 1 }),
    ).resolves.toEqual(Buffer.from('render-2-1'))
  })

  it('long-polls a local in-flight render and loads html lazily', async () => {
    let renderCount = 0
    let loadHtmlCount = 0
    let releaseRender!: () => void
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve
    })
    const { service } = await setup(async () => {
      renderCount += 1
      await renderGate
      return {
        ok: true,
        slides: [Buffer.from('one'), Buffer.from('two')],
        slideCount: 2,
        width: 480,
        height: 270,
        durationMs: 1,
      }
    })

    const statusPromise = service.getStatus({
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
    // Let the long-poll attach to the in-flight job, then finish the render.
    await Promise.resolve()
    releaseRender()
    const status = await statusPromise

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

  it('re-enqueues stale pending work left behind after a restart', async () => {
    let renderCount = 0
    let loadHtmlCount = 0
    const { service, cache } = await setup(async () => {
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
    const pendingMeta = await cache.readMeta(key)
    expect(pendingMeta).not.toBeNull()
    await cache.writeMeta(key, {
      ...pendingMeta!,
      // Past THUMBNAIL_PENDING_LEASE_MS (deck timeout + 30s).
      updatedAt: new Date(Date.now() - 80_000).toISOString(),
    })

    const status = await service.getStatus({
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: key.versionId,
      manifestHash: key.manifestHash,
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

  it('recovers orphaned pending across service instances sharing a cache dir', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))
    const deckStore = createDeckStore(dataDir)
    const cache = createThumbnailCache(cacheDir)
    const key = {
      versionId: 'a0000000-0000-4000-8000-000000000003',
      manifestHash: 'abc123',
    }

    // Simulate a previous API process that marked pending then died.
    const previous = trackService(
      createThumbnailService({
        cache,
        deckStore,
        renderer: createFakeRenderer(async () => {
          throw new Error('previous process should not render')
        }),
      }),
    )
    await cache.markPending(key, {
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: key.versionId,
      manifestHash: key.manifestHash,
      slideCount: 0,
      width: 480,
      height: 270,
    })
    await previous.close()

    const pendingMeta = await cache.readMeta(key)
    await cache.writeMeta(key, {
      ...pendingMeta!,
      updatedAt: new Date(Date.now() - 80_000).toISOString(),
    })

    let renderCount = 0
    const restarted = trackService(
      createThumbnailService({
        cache,
        deckStore,
        renderer: createFakeRenderer(async (request) => {
          renderCount += 1
          return renderRequestedSlides(request)
        }),
      }),
    )

    const status = await restarted.getStatus({
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: key.versionId,
      manifestHash: key.manifestHash,
      enqueueIfMissing: true,
      waitMs: 500,
      html: sampleHtml,
    })

    expect(status.status).toBe(THUMBNAIL_STATUS.ready)
    expect(renderCount).toBe(1)
    await restarted.close()
  })

  it('records failed renders without crashing the queue', async () => {
    const { service, cache } = await setup(async () => ({
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

    const key = {
      versionId: 'a0000000-0000-4000-8000-000000000001',
      manifestHash: 'abc123',
    }

    await vi.waitFor(async () => {
      const meta = await cache.readMeta(key)
      expect(meta?.status).toBe(THUMBNAIL_STATUS.failed)
      expect(meta?.error).toBe('boom')
    })

    // Retriable failures are reported as pending so clients keep long-polling.
    const status = await service.getStatus({
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: key.versionId,
      manifestHash: key.manifestHash,
    })
    expect(status.status).toBe(THUMBNAIL_STATUS.pending)
    expect(status.slides).toEqual([])
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
    const key = { versionId: statusInput.versionId, manifestHash: statusInput.manifestHash }

    await service.enqueue({ ...statusInput, html: sampleHtml })

    await vi.waitFor(async () => {
      const meta = await cache.readMeta(key)
      expect(meta?.status).toBe(THUMBNAIL_STATUS.failed)
      expect(meta?.attempts).toBe(1)
    })

    // Client-facing status stays pending (retriable) so long-poll continues.
    const afterFailure = await service.getStatus(statusInput)
    expect(afterFailure.status).toBe(THUMBNAIL_STATUS.pending)

    // Within the retry delay the failure is not re-enqueued yet.
    const beforeDelay = await service.getStatus({
      ...statusInput,
      enqueueIfMissing: true,
      html: sampleHtml,
    })
    expect(beforeDelay.status).toBe(THUMBNAIL_STATUS.pending)
    expect(renderCount).toBe(1)

    // Age the failure past the retry delay, then poll again.
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

  it('runs queued foreground jobs before background warms', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))

    let releaseBlocker: (() => void) | null = null
    const blockerGate = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    const renderOrder: string[] = []
    const blockerVersionId = 'a0000000-0000-4000-8000-000000000090'
    const foregroundVersionId = 'a0000000-0000-4000-8000-000000000091'
    const deckStore = createDeckStore(dataDir)
    const service = trackService(
      createThumbnailService({
        cache: createThumbnailCache(cacheDir),
        deckStore,
        renderer: {
          isAvailable: () => true,
          close: async () => undefined,
          render: async (request) => {
            const versionId = request.versionId ?? 'unknown'
            renderOrder.push(versionId)

            if (versionId === blockerVersionId) {
              await blockerGate
            }

            return {
              ok: true,
              slides: (request.slideIndexes ?? [0, 1]).map(() => Buffer.from('png')),
              slideCount: 2,
              width: 480,
              height: 270,
              durationMs: 1,
            }
          },
        },
      }),
    )

    const created = await deckStore.createDeck(
      sampleHtml.replace('<h1>One</h1>', '<h1>One warm</h1>'),
      { source: 'upload' },
    )
    const warmVersionId = created.activeVersionId!

    await service.enqueue({
      deckId: 'b0000000-0000-4000-8000-000000000090',
      versionId: blockerVersionId,
      html: sampleHtml.replace('<h1>One</h1>', '<h1>One blocker</h1>'),
      manifestHash: 'abc123',
    })
    await service.enqueueForDeckVersion(created.id, warmVersionId)
    await service.getStatus({
      deckId: 'b0000000-0000-4000-8000-000000000091',
      versionId: foregroundVersionId,
      manifestHash: 'abc123',
      enqueueIfMissing: true,
      html: sampleHtml.replace('<h1>One</h1>', '<h1>One foreground</h1>'),
    })

    releaseBlocker?.()

    await vi.waitFor(() => {
      expect(renderOrder).toHaveLength(3)
    })
    expect(renderOrder).toEqual([blockerVersionId, foregroundVersionId, warmVersionId])
  })

  it('discards queued obsolete background warms for the same deck', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))

    let releaseBlocker: (() => void) | null = null
    const blockerGate = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    const renderOrder: string[] = []
    const logs: CapturedLogEntry[] = []
    const blockerVersionId = 'a0000000-0000-4000-8000-000000000092'
    const deckStore = createDeckStore(dataDir)
    const service = trackService(
      createThumbnailService({
        cache: createThumbnailCache(cacheDir),
        deckStore,
        queueMaxPending: TEST_QUEUE_MAX_PENDING,
        logger: createTestLogger(logs),
        renderer: {
          isAvailable: () => true,
          close: async () => undefined,
          render: async (request) => {
            const versionId = request.versionId ?? 'unknown'
            renderOrder.push(versionId)

            if (versionId === blockerVersionId) {
              await blockerGate
            }

            return {
              ok: true,
              slides: (request.slideIndexes ?? [0, 1]).map(() => Buffer.from('png')),
              slideCount: 2,
              width: 480,
              height: 270,
              durationMs: 1,
            }
          },
        },
      }),
    )

    const created = await deckStore.createDeck(sampleHtml, { source: 'upload' })
    const oldWarmVersionId = created.activeVersionId!
    const updated = await deckStore.updateDeck(
      created.id,
      sampleHtml.replace('Two', 'Two updated'),
      {
        source: 'manual',
      },
    )
    const newWarmVersionId = updated!.activeVersionId!

    await service.enqueue({
      deckId: 'b0000000-0000-4000-8000-000000000092',
      versionId: blockerVersionId,
      html: sampleHtml,
      manifestHash: 'abc123',
    })
    await service.enqueueForDeckVersion(created.id, oldWarmVersionId)
    await service.enqueueForDeckVersion(created.id, newWarmVersionId)

    releaseBlocker?.()

    await vi.waitFor(() => {
      expect(renderOrder).toHaveLength(2)
    })
    expect(renderOrder).toEqual([blockerVersionId, newWarmVersionId])
    expect(renderOrder).not.toContain(oldWarmVersionId)

    const discard = logs.find((entry) => entry.event === 'thumbnail.queue.discarded')
    expect(discard?.fields.fields).toMatchObject({
      versionId: oldWarmVersionId,
      replacementVersionId: newWarmVersionId,
      reason: 'obsolete_warm',
    })
  })

  it('aborts an in-flight obsolete background warm for the same deck', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))

    const renderOrder: string[] = []
    const logs: CapturedLogEntry[] = []
    const seenSignals: Array<AbortSignal | undefined> = []
    let oldWarmVersionId = ''
    let releaseOldRender: (() => void) | null = null
    let resolveOldRenderStarted: (() => void) | null = null
    const oldRenderStarted = new Promise<void>((resolve) => {
      resolveOldRenderStarted = resolve
    })
    const oldRenderGate = new Promise<void>((resolve) => {
      releaseOldRender = resolve
    })
    const deckStore = createDeckStore(dataDir)
    const service = trackService(
      createThumbnailService({
        cache: createThumbnailCache(cacheDir),
        deckStore,
        logger: createTestLogger(logs),
        renderer: {
          isAvailable: () => true,
          close: async () => undefined,
          render: async (request) => {
            const versionId = request.versionId ?? 'unknown'
            seenSignals.push(request.signal)
            renderOrder.push(versionId)
            resolveOldRenderStarted?.()

            if (versionId === oldWarmVersionId) {
              try {
                await Promise.race([
                  oldRenderGate,
                  new Promise<void>((_resolve, reject) => {
                    if (request.signal?.aborted) {
                      reject(new Error('Thumbnail render aborted.'))
                      return
                    }

                    request.signal?.addEventListener(
                      'abort',
                      () => reject(new Error('Thumbnail render aborted.')),
                      { once: true },
                    )
                  }),
                ])
              } catch (error) {
                return {
                  ok: false as const,
                  error: error instanceof Error ? error.message : 'Thumbnail render aborted.',
                  durationMs: 1,
                  aborted: true,
                }
              }
            }

            return {
              ok: true,
              slides: (request.slideIndexes ?? [0, 1]).map(() => Buffer.from('png')),
              slideCount: 2,
              width: 480,
              height: 270,
              durationMs: 1,
            }
          },
        },
      }),
    )

    const created = await deckStore.createDeck(sampleHtml, { source: 'upload' })
    oldWarmVersionId = created.activeVersionId!
    await service.enqueueForDeckVersion(created.id, oldWarmVersionId)
    await oldRenderStarted

    const updated = await deckStore.updateDeck(
      created.id,
      sampleHtml.replace('Two', 'Two updated'),
      {
        source: 'manual',
      },
    )
    const newWarmVersionId = updated!.activeVersionId!
    await service.enqueueForDeckVersion(created.id, newWarmVersionId)

    await vi.waitFor(() => {
      expect(renderOrder).toContain(newWarmVersionId)
    })
    expect(seenSignals[0]?.aborted).toBe(true)

    const abortLog = logs.find((entry) => entry.event === 'thumbnail.queue.aborted')
    expect(abortLog?.fields.fields).toMatchObject({
      versionId: oldWarmVersionId,
      replacementVersionId: newWarmVersionId,
      reason: 'obsolete_warm',
    })

    releaseOldRender?.()
  })

  it('promotes a running background warm when a foreground poller waits', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))

    const logs: CapturedLogEntry[] = []
    let releaseRender: (() => void) | null = null
    let resolveRenderStarted: (() => void) | null = null
    const renderStarted = new Promise<void>((resolve) => {
      resolveRenderStarted = resolve
    })
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve
    })
    const seenSignals: Array<AbortSignal | undefined> = []
    const deckStore = createDeckStore(dataDir)
    const service = trackService(
      createThumbnailService({
        cache: createThumbnailCache(cacheDir),
        deckStore,
        logger: createTestLogger(logs),
        renderer: {
          isAvailable: () => true,
          close: async () => undefined,
          render: async (request) => {
            seenSignals.push(request.signal)
            resolveRenderStarted?.()
            await renderGate
            return {
              ok: true,
              slides: (request.slideIndexes ?? [0, 1]).map(() => Buffer.from('png')),
              slideCount: 2,
              width: 480,
              height: 270,
              durationMs: 1,
            }
          },
        },
      }),
    )

    const created = await deckStore.createDeck(sampleHtml, { source: 'upload' })
    const versionId = created.activeVersionId!
    await service.enqueueForDeckVersion(created.id, versionId)
    await renderStarted

    const statusPromise = service.getStatus({
      deckId: created.id,
      versionId,
      manifestHash: 'none',
      html: sampleHtml,
      enqueueIfMissing: true,
      waitMs: 5_000,
    })

    await vi.waitFor(() => {
      expect(logs.some((entry) => entry.event === 'thumbnail.queue.promoted')).toBe(true)
    })

    const updated = await deckStore.updateDeck(
      created.id,
      sampleHtml.replace('Two', 'Two updated'),
      { source: 'manual' },
    )
    await service.enqueueForDeckVersion(created.id, updated!.activeVersionId!)

    expect(seenSignals[0]?.aborted).toBe(false)

    releaseRender?.()
    const status = await statusPromise
    expect(status.status).toBe('ready')
  })

  it('keeps aborted warm versions retryable after supersede', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))

    const cache = createThumbnailCache(cacheDir)
    let oldWarmVersionId = ''
    let releaseOldRender: (() => void) | null = null
    let resolveOldRenderStarted: (() => void) | null = null
    const oldRenderStarted = new Promise<void>((resolve) => {
      resolveOldRenderStarted = resolve
    })
    const oldRenderGate = new Promise<void>((resolve) => {
      releaseOldRender = resolve
    })
    const deckStore = createDeckStore(dataDir)
    const service = trackService(
      createThumbnailService({
        cache,
        deckStore,
        renderer: {
          isAvailable: () => true,
          close: async () => undefined,
          render: async (request) => {
            const versionId = request.versionId ?? 'unknown'
            resolveOldRenderStarted?.()

            if (versionId === oldWarmVersionId) {
              try {
                await Promise.race([
                  oldRenderGate,
                  new Promise<void>((_resolve, reject) => {
                    if (request.signal?.aborted) {
                      reject(new Error('Thumbnail render aborted.'))
                      return
                    }

                    request.signal?.addEventListener(
                      'abort',
                      () => reject(new Error('Thumbnail render aborted.')),
                      { once: true },
                    )
                  }),
                ])
              } catch (error) {
                return {
                  ok: false as const,
                  error: error instanceof Error ? error.message : 'Thumbnail render aborted.',
                  durationMs: 1,
                  aborted: true,
                }
              }
            }

            return {
              ok: true,
              slides: (request.slideIndexes ?? [0, 1]).map(() => Buffer.from('png')),
              slideCount: 2,
              width: 480,
              height: 270,
              durationMs: 1,
            }
          },
        },
      }),
    )

    const created = await deckStore.createDeck(sampleHtml, { source: 'upload' })
    oldWarmVersionId = created.activeVersionId!
    await service.enqueueForDeckVersion(created.id, oldWarmVersionId)
    await oldRenderStarted

    const updated = await deckStore.updateDeck(
      created.id,
      sampleHtml.replace('Two', 'Two updated'),
      { source: 'manual' },
    )
    await service.enqueueForDeckVersion(created.id, updated!.activeVersionId!)

    await vi.waitFor(async () => {
      const meta = await cache.readMeta(buildThumbnailCacheKey(oldWarmVersionId, 'none'))
      expect(meta?.status).toBe('failed')
      expect(meta?.attempts ?? 0).toBeLessThan(3)
    })

    releaseOldRender?.()
  })

  it('preserves a newer warm when an older warm resolves out of order', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))

    let releaseBlocker: (() => void) | null = null
    const blockerGate = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    const renderOrder: string[] = []
    const logs: CapturedLogEntry[] = []
    const blockerVersionId = 'a0000000-0000-4000-8000-000000000093'
    const deckStore = createDeckStore(dataDir)
    const service = trackService(
      createThumbnailService({
        cache: createThumbnailCache(cacheDir),
        deckStore,
        logger: createTestLogger(logs),
        renderer: {
          isAvailable: () => true,
          close: async () => undefined,
          render: async (request) => {
            const versionId = request.versionId ?? 'unknown'
            renderOrder.push(versionId)

            if (versionId === blockerVersionId) {
              await blockerGate
            }

            return {
              ok: true,
              slides: (request.slideIndexes ?? [0, 1]).map(() => Buffer.from('png')),
              slideCount: 2,
              width: 480,
              height: 270,
              durationMs: 1,
            }
          },
        },
      }),
    )

    const created = await deckStore.createDeck(sampleHtml, { source: 'upload' })
    const oldWarmVersionId = created.activeVersionId!
    const updated = await deckStore.updateDeck(
      created.id,
      sampleHtml.replace('Two', 'Two updated'),
      {
        source: 'manual',
      },
    )
    const newWarmVersionId = updated!.activeVersionId!

    let releaseOldVersion: (() => void) | null = null
    const oldVersionGate = new Promise<void>((resolve) => {
      releaseOldVersion = resolve
    })
    const originalGetVersion = deckStore.getVersion.bind(deckStore)
    vi.spyOn(deckStore, 'getVersion').mockImplementation(async (deckId, versionId) => {
      const version = await originalGetVersion(deckId, versionId)

      if (versionId === oldWarmVersionId) {
        await oldVersionGate
      }

      return version
    })

    await service.enqueue({
      deckId: 'b0000000-0000-4000-8000-000000000093',
      versionId: blockerVersionId,
      html: sampleHtml,
      manifestHash: 'abc123',
    })

    const olderWarm = service.enqueueForDeckVersion(created.id, oldWarmVersionId)
    const newerWarm = service.enqueueForDeckVersion(created.id, newWarmVersionId)
    await newerWarm
    releaseOldVersion?.()
    await olderWarm

    releaseBlocker?.()

    await vi.waitFor(() => {
      expect(renderOrder).toHaveLength(2)
    })
    expect(renderOrder).toEqual([blockerVersionId, newWarmVersionId])
    expect(renderOrder).not.toContain(oldWarmVersionId)

    const discard = logs.find(
      (entry) =>
        entry.event === 'thumbnail.queue.discarded' &&
        entry.fields.fields?.versionId === oldWarmVersionId,
    )
    expect(discard?.fields.fields).toMatchObject({
      versionId: oldWarmVersionId,
      reason: 'obsolete_warm',
    })
  })

  it('evicts a queued background warm so foreground can enqueue when saturated', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))

    let releaseGate: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const renderedVersions: string[] = []
    const logs: CapturedLogEntry[] = []
    const deckStore = createDeckStore(dataDir)
    const service = trackService(
      createThumbnailService({
        cache: createThumbnailCache(cacheDir),
        deckStore,
        queueMaxPending: TEST_QUEUE_MAX_PENDING,
        logger: createTestLogger(logs),
        renderer: {
          isAvailable: () => true,
          close: async () => undefined,
          render: async (request) => {
            await gate
            renderedVersions.push(request.versionId ?? 'unknown')
            return {
              ok: true,
              slides: (request.slideIndexes ?? [0, 1]).map(() => Buffer.from('png')),
              slideCount: 2,
              width: 480,
              height: 270,
              durationMs: 1,
            }
          },
        },
      }),
    )

    const warmVersionIds: string[] = []
    for (let index = 0; index < TEST_QUEUE_MAX_PENDING; index += 1) {
      const created = await deckStore.createDeck(
        sampleHtml.replace('<h1>One</h1>', `<h1>One warm ${index}</h1>`),
        { source: 'upload' },
      )
      const versionId = created.activeVersionId!
      warmVersionIds.push(versionId)
      await service.enqueueForDeckVersion(created.id, versionId)
    }

    const foregroundVersionId = 'a0000000-0000-4000-8000-000000000099'
    const status = await service.getStatus({
      deckId: 'b0000000-0000-4000-8000-000000000099',
      versionId: foregroundVersionId,
      manifestHash: 'abc123',
      enqueueIfMissing: true,
      waitMs: 25,
      html: sampleHtml.replace('<h1>One</h1>', '<h1>One foreground</h1>'),
    })

    expect(status.status).toBe(THUMBNAIL_STATUS.pending)

    const evicted = logs.find(
      (entry) =>
        entry.event === 'thumbnail.queue.discarded' &&
        entry.fields.fields?.reason === 'foreground_priority',
    )
    expect(evicted).toBeDefined()
    expect(warmVersionIds).toContain(evicted?.fields.fields?.versionId)

    releaseGate?.()

    await vi.waitFor(
      () => {
        expect(renderedVersions).toHaveLength(TEST_QUEUE_MAX_PENDING)
        expect(renderedVersions).toContain(foregroundVersionId)
      },
      { timeout: QUEUE_DRAIN_WAIT_MS },
    )
    expect(renderedVersions).not.toContain(evicted?.fields.fields?.versionId)
  })

  it('logs queue wait, render, and cache write timings for completed jobs', async () => {
    const logs: CapturedLogEntry[] = []
    const { service } = await setup(
      async () => ({
        ok: true,
        slides: [Buffer.from('one'), Buffer.from('two')],
        slideCount: 2,
        width: 480,
        height: 270,
        durationMs: 7,
      }),
      { logger: createTestLogger(logs) },
    )

    const statusInput = {
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: 'a0000000-0000-4000-8000-000000000001',
      manifestHash: 'abc123',
    }

    await service.enqueue({ ...statusInput, html: sampleHtml })

    // Ready status is written before the completed log; wait for the log so
    // assertions do not race the queue worker's post-run logging.
    await vi.waitFor(() => {
      const completed = logs.find((entry) => entry.event === 'thumbnail.queue.completed')
      expect(completed?.fields.durationMs).toEqual(expect.any(Number))
      expect(completed?.fields.fields).toMatchObject({
        versionId: statusInput.versionId,
        manifestHash: statusInput.manifestHash,
        priority: 'foreground',
        queueWaitMs: expect.any(Number),
        renderMs: 7,
        cacheWriteMs: expect.any(Number),
        status: THUMBNAIL_STATUS.ready,
        slideCount: 2,
      })
    })
  })

  it('skips new jobs while the queue is saturated and accepts them after it drains', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))

    let releaseGate: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const renderedVersions: string[] = []
    const service = trackService(
      createThumbnailService({
        cache: createThumbnailCache(cacheDir),
        deckStore: createDeckStore(dataDir),
        queueMaxPending: TEST_QUEUE_MAX_PENDING,
        renderer: {
          isAvailable: () => true,
          close: async () => undefined,
          render: async (request) => {
            await gate
            renderedVersions.push(request.versionId ?? 'unknown')
            return {
              ok: true,
              slides: (request.slideIndexes ?? [0, 1]).map(() => Buffer.from('png')),
              slideCount: 2,
              width: 480,
              height: 270,
              durationMs: 1,
            }
          },
        },
      }),
    )

    const versionId = (index: number) =>
      `a0000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    const htmlForVersion = (index: number) =>
      sampleHtml.replace('<h1>Two</h1>', `<h1>Two ${index}</h1>`)
    const enqueueVersion = (index: number) =>
      service.enqueue({
        deckId: 'b0000000-0000-4000-8000-000000000001',
        versionId: versionId(index),
        html: htmlForVersion(index),
        manifestHash: 'abc123',
      })

    // Fill the injectable queue bound (same policy as production's larger default).
    for (let index = 0; index < TEST_QUEUE_MAX_PENDING; index += 1) {
      await enqueueVersion(index)
    }

    // One more while saturated: skipped, reported as pending.
    const overflow = await enqueueVersion(TEST_QUEUE_MAX_PENDING)
    expect(overflow.status).toBe(THUMBNAIL_STATUS.pending)

    releaseGate?.()

    await vi.waitFor(
      () => {
        expect(renderedVersions).toHaveLength(TEST_QUEUE_MAX_PENDING)
      },
      { timeout: QUEUE_DRAIN_WAIT_MS },
    )
    expect(renderedVersions).not.toContain(versionId(TEST_QUEUE_MAX_PENDING))

    // Once drained, re-enqueueing the skipped version renders it.
    await enqueueVersion(TEST_QUEUE_MAX_PENDING)
    await vi.waitFor(
      () => {
        expect(renderedVersions).toContain(versionId(TEST_QUEUE_MAX_PENDING))
      },
      { timeout: QUEUE_DRAIN_WAIT_MS },
    )
  })

  it('does not load html for a missing render while the queue is saturated', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))

    let releaseGate: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const renderedVersions: string[] = []
    const service = trackService(
      createThumbnailService({
        cache: createThumbnailCache(cacheDir),
        deckStore: createDeckStore(dataDir),
        queueMaxPending: TEST_QUEUE_MAX_PENDING,
        renderer: {
          isAvailable: () => true,
          close: async () => undefined,
          render: async (request) => {
            await gate
            renderedVersions.push(request.versionId ?? 'unknown')
            return {
              ok: true,
              slides: (request.slideIndexes ?? [0, 1]).map(() => Buffer.from('png')),
              slideCount: 2,
              width: 480,
              height: 270,
              durationMs: 1,
            }
          },
        },
      }),
    )

    const versionId = (index: number) =>
      `a0000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    const htmlForVersion = (index: number) =>
      sampleHtml.replace('<h1>Two</h1>', `<h1>Two ${index}</h1>`)
    for (let index = 0; index < TEST_QUEUE_MAX_PENDING; index += 1) {
      await service.enqueue({
        deckId: 'b0000000-0000-4000-8000-000000000001',
        versionId: versionId(index),
        html: htmlForVersion(index),
        manifestHash: 'abc123',
      })
    }

    let loadHtmlCount = 0
    const overflow = await service.getStatus({
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: versionId(TEST_QUEUE_MAX_PENDING),
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
    await vi.waitFor(
      () => {
        expect(renderedVersions).toHaveLength(TEST_QUEUE_MAX_PENDING)
      },
      { timeout: QUEUE_DRAIN_WAIT_MS },
    )
  })

  it('returns disabled when the renderer is unavailable', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))
    const service = trackService(
      createThumbnailService({
        cache: createThumbnailCache(cacheDir),
        deckStore: createDeckStore(dataDir),
        queueMaxPending: TEST_QUEUE_MAX_PENDING,
        renderer: {
          isAvailable: () => false,
          render: async () => ({ ok: false, error: 'disabled', durationMs: 0 }),
          close: async () => undefined,
        },
      }),
    )

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
