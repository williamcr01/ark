import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../app.ts'
import { createDeckStore } from '../deck-store.ts'
import { createPreviewSessionStore } from '../preview-sessions.ts'
import { createThumbnailCache } from './cache.ts'
import {
  createChromiumPool,
  findChromium,
  isThumbnailRendererAvailable,
  listPageTargets,
  type BrowserPage,
  type ChromiumPool,
  type CdpClient,
} from './chromium.ts'
import { collectExternalNetworkRequests, createThumbnailRenderer } from './renderer.ts'
import { createThumbnailService } from './service.ts'

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../test/fixtures',
)
const plainCssDeck = readFileSync(path.join(fixtureDir, 'plain-css-deck.html'), 'utf8')
const revealRegistryDeck = readFileSync(path.join(fixtureDir, 'reveal-registry-deck.html'), 'utf8')
const hostileExternalFetchDeck = readFileSync(
  path.join(fixtureDir, 'hostile-external-fetch-deck.html'),
  'utf8',
)
const hostilePopupsDeck = readFileSync(path.join(fixtureDir, 'hostile-popups-deck.html'), 'utf8')
const hostileFormsDeck = readFileSync(path.join(fixtureDir, 'hostile-forms-deck.html'), 'utf8')
const hostileNavigationDeck = readFileSync(
  path.join(fixtureDir, 'hostile-navigation-deck.html'),
  'utf8',
)
const hostileObjectEmbedDeck = readFileSync(
  path.join(fixtureDir, 'hostile-object-embed-deck.html'),
  'utf8',
)
const hostileSandboxNetworkDeck = readFileSync(
  path.join(fixtureDir, 'hostile-sandbox-network-deck.html'),
  'utf8',
)
const hostileIframesDeck = readFileSync(path.join(fixtureDir, 'hostile-iframes-deck.html'), 'utf8')
const malformedDeck = readFileSync(path.join(fixtureDir, 'malformed-deck.html'), 'utf8')

const liveChromiumTestsEnabled =
  process.env.ARK_LIVE_CHROMIUM_TESTS === '1' ||
  process.env.ARK_LIVE_CHROMIUM_TESTS === 'true' ||
  process.env.ARK_LIVE_CHROMIUM_TESTS === 'on'
const chromiumAvailable = Boolean(findChromium())
const tinyPngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')

function createMockCdp(options: {
  ready?: boolean
  slideIndex?: number
  screenshotData?: string
  onNavigate?: () => void
  onScreenshot?: (params: unknown, sessionId: string | null) => void
  onEvaluate?: (expression: string) => { handled: true; value: unknown } | undefined
}): CdpClient {
  const listeners = new Map<string, Array<(params: unknown, sessionId: string | null) => void>>()
  let slideIndex = options.slideIndex ?? 0

  return {
    send: async (method: string, params?: unknown, sessionId: string | null = null) => {
      if (method === 'Page.navigate') {
        options.onNavigate?.()
        return {}
      }

      if (method === 'Target.getTargets') {
        return {
          targetInfos: [
            {
              targetId: 'mock-frame',
              type: 'iframe',
              url: 'http://127.0.0.1:9/api/thumbnail-render/token',
            },
          ],
        }
      }

      if (method === 'Target.attachToTarget') {
        return { sessionId: 'mock-frame-session' }
      }

      if (method === 'Page.captureScreenshot') {
        options.onScreenshot?.(params, sessionId)
        return { data: options.screenshotData ?? tinyPngBase64 }
      }

      if (method === 'Runtime.evaluate') {
        const expression = String((params as { expression?: string } | undefined)?.expression ?? '')
        const custom = options.onEvaluate?.(expression)

        if (custom?.handled) {
          return { result: { value: custom.value } }
        }

        if (expression.includes('__arkThumbReady')) {
          return {
            result: {
              value: {
                ready: Boolean(options.ready),
                slideCount: 1,
                index: slideIndex,
                errors: [],
              },
            },
          }
        }

        if (expression.includes('__arkThumbGoto')) {
          const match = /__arkThumbGoto\((\d+)\)/.exec(expression)
          slideIndex = match ? Number(match[1]) : slideIndex
          return { result: { value: true } }
        }

        if (expression.includes('current: Number(window.__arkThumbIndex')) {
          return { result: { value: { current: slideIndex, errors: [] } } }
        }

        if (expression.includes('__arkThumbIndex')) {
          return { result: { value: slideIndex } }
        }

        return { result: { value: null } }
      }

      return {}
    },
    waitForEvent: async (method: string) => {
      if (method === 'Page.loadEventFired') {
        return {}
      }

      throw new Error(`Unexpected waitForEvent: ${method}`)
    },
    on: (method, listener) => {
      const existing = listeners.get(method) ?? []
      existing.push(listener)
      listeners.set(method, existing)
      return () => undefined
    },
    close: () => undefined,
  } as unknown as CdpClient
}

function createMockPool(options: {
  ready?: boolean
  screenshotData?: string
  createPageImpl?: () => Promise<BrowserPage>
  onEvaluate?: (expression: string) => { handled: true; value: unknown } | undefined
  onScreenshot?: (params: unknown, sessionId: string | null) => void
}): { pool: ChromiumPool; closedPages: { count: number } } {
  const closedPages = { count: 0 }

  const pool: ChromiumPool = {
    isAvailable: () => true,
    ensureBrowser: async () => {
      throw new Error('ensureBrowser should not be required for mock pages')
    },
    createPage:
      options.createPageImpl ??
      (async () => {
        const cdp = createMockCdp({
          ready: options.ready,
          screenshotData: options.screenshotData,
          onEvaluate: options.onEvaluate,
          onScreenshot: options.onScreenshot,
        })
        return {
          cdp,
          targetId: 'mock-target',
          close: async () => {
            closedPages.count += 1
            cdp.close()
          },
        }
      }),
    close: async () => undefined,
  }

  return { pool, closedPages }
}

describe('collectExternalNetworkRequests', () => {
  it('allows same-origin and data/blob urls while flagging external http(s)', () => {
    expect(
      collectExternalNetworkRequests(
        [
          { url: 'http://127.0.0.1:8787/api/runtimes/reveal.js/5.1.0/reveal.js' },
          { url: 'data:image/png;base64,abc' },
          { url: 'blob:http://127.0.0.1:8787/uuid' },
          { url: 'https://evil.example/fetch' },
        ],
        'http://127.0.0.1:8787',
      ),
    ).toEqual([{ url: 'https://evil.example/fetch' }])
  })
})

describe('thumbnail renderer limits (unit)', () => {
  it('rejects decks that exceed the slide limit before opening a page', async () => {
    let createPageCalls = 0
    const { pool } = createMockPool({
      createPageImpl: async () => {
        createPageCalls += 1
        throw new Error('should not open a page')
      },
    })
    const previewSessionStore = createPreviewSessionStore()
    const renderer = createThumbnailRenderer({
      previewSessionStore,
      chromiumPool: pool,
      apiOrigin: 'http://127.0.0.1:9',
      enabled: true,
      renderSecret: 'test-secret',
      limits: { maxSlides: 1 },
    })

    const result = await renderer.render({ html: plainCssDeck })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }

    expect(result.error).toMatch(/at most 1/)
    expect(createPageCalls).toBe(0)
  })

  it('fails when a screenshot exceeds the png size limit and still closes the page', async () => {
    const oversized = Buffer.alloc(64, 1).toString('base64')
    const mock = createMockPool({ ready: true, screenshotData: oversized })
    const previewSessionStore = createPreviewSessionStore()
    const renderer = createThumbnailRenderer({
      previewSessionStore,
      chromiumPool: mock.pool,
      apiOrigin: 'http://127.0.0.1:9',
      enabled: true,
      renderSecret: 'test-secret',
      limits: {
        maxPngBytes: 8,
        readyTimeoutMs: 200,
        slideTimeoutMs: 200,
        deckTimeoutMs: 1_000,
        settleMs: 0,
      },
    })

    // Use a one-slide deck so the mock CDP ready/index path stays simple.
    const oneSlide = `<!DOCTYPE html><html><body><section class="slide"><h1>One</h1></section></body></html>`
    const result = await renderer.render({ html: oneSlide })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }

    expect(result.error).toMatch(/exceeded size limit/)
    expect(mock.closedPages.count).toBe(1)
  })

  it('waits for adaptive slide settle acknowledgement before capturing', async () => {
    let settleRequested = false
    let settlePolls = 0
    let capturedBeforeSettled = false
    const screenshotSessions: Array<string | null> = []
    const mock = createMockPool({
      ready: true,
      onEvaluate: (expression) => {
        if (expression.includes('__arkThumbRequestSettle')) {
          settleRequested = true
          return { handled: true, value: 7 }
        }

        if (expression.includes('__arkThumbSettledRequestId')) {
          settlePolls += 1
          return {
            handled: true,
            value: {
              settled: settlePolls >= 2,
              errors: [],
            },
          }
        }

        return undefined
      },
      onScreenshot: (_params, sessionId) => {
        capturedBeforeSettled = settlePolls < 2
        screenshotSessions.push(sessionId)
      },
    })
    const previewSessionStore = createPreviewSessionStore()
    const renderer = createThumbnailRenderer({
      previewSessionStore,
      chromiumPool: mock.pool,
      apiOrigin: 'http://127.0.0.1:9',
      enabled: true,
      renderSecret: 'test-secret',
      limits: {
        readyTimeoutMs: 200,
        slideTimeoutMs: 500,
        deckTimeoutMs: 1_000,
        settleMs: 120,
      },
    })

    const oneSlide = `<!DOCTYPE html><html><body><section class="slide"><h1>One</h1></section></body></html>`
    const result = await renderer.render({ html: oneSlide })

    expect(result.ok).toBe(true)
    expect(settleRequested).toBe(true)
    expect(settlePolls).toBeGreaterThanOrEqual(2)
    expect(capturedBeforeSettled).toBe(false)
    expect(screenshotSessions).toEqual(['mock-frame-session'])
    expect(mock.closedPages.count).toBe(1)
  })

  it('recognizes slide index 0 as settled via nullish coalescing', async () => {
    let settleExpression = ''
    let settlePolls = 0
    const settledRequestId = 1
    const settledIndex = 0
    const mock = createMockPool({
      ready: true,
      onEvaluate: (expression) => {
        if (expression.includes('__arkThumbRequestSettle')) {
          return { handled: true, value: settledRequestId }
        }

        if (expression.includes('__arkThumbSettledRequestId')) {
          settleExpression = expression
          settlePolls += 1
          // Mimic CDP evaluating the host expression against index 0.
          // `0 || -1` would incorrectly yield -1; `0 ?? -1` keeps 0.
          const settled =
            Number(settledRequestId || 0) === settledRequestId && Number(settledIndex ?? -1) === 0
          return {
            handled: true,
            value: {
              settled,
              errors: [],
            },
          }
        }

        return undefined
      },
    })
    const previewSessionStore = createPreviewSessionStore()
    const renderer = createThumbnailRenderer({
      previewSessionStore,
      chromiumPool: mock.pool,
      apiOrigin: 'http://127.0.0.1:9',
      enabled: true,
      renderSecret: 'test-secret',
      limits: {
        readyTimeoutMs: 200,
        slideTimeoutMs: 500,
        deckTimeoutMs: 1_000,
        settleMs: 120,
      },
    })

    const oneSlide = `<!DOCTYPE html><html><body><section class="slide"><h1>One</h1></section></body></html>`
    const result = await renderer.render({ html: oneSlide })

    expect(result.ok).toBe(true)
    expect(settlePolls).toBeGreaterThanOrEqual(1)
    expect(settleExpression).toMatch(/__arkThumbSettledIndex\s*\?\?\s*-1/)
    expect(settleExpression).not.toMatch(/__arkThumbSettledIndex\s*\|\|\s*-1/)
    // Guard the regression: logical OR treats 0 as missing; nullish coalesce does not.
    const zeroIndex: number | undefined = 0
    expect(Number(zeroIndex || -1)).toBe(-1)
    expect(Number(zeroIndex ?? -1)).toBe(0)
    expect(mock.closedPages.count).toBe(1)
  })

  it('times out when the deck never becomes ready and disposes the page', async () => {
    const mock = createMockPool({ ready: false })
    const previewSessionStore = createPreviewSessionStore()
    const renderer = createThumbnailRenderer({
      previewSessionStore,
      chromiumPool: mock.pool,
      apiOrigin: 'http://127.0.0.1:9',
      enabled: true,
      renderSecret: 'test-secret',
      limits: {
        readyTimeoutMs: 80,
        slideTimeoutMs: 80,
        deckTimeoutMs: 250,
        settleMs: 0,
      },
    })

    const oneSlide = `<!DOCTYPE html><html><body><section class="slide"><h1>One</h1></section></body></html>`
    const result = await renderer.render({ html: oneSlide })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }

    expect(result.error).toMatch(/Timed out waiting for (deck ready|deck thumbnail render)/)
    expect(mock.closedPages.count).toBe(1)
  })
})

describe.runIf(liveChromiumTestsEnabled && chromiumAvailable)(
  'thumbnail renderer (live chromium)',
  () => {
    let dataDir = ''
    let cacheDir = ''
    let server: Server | null = null
    let serviceClose: (() => Promise<void>) | null = null
    let previewSessionStore = createPreviewSessionStore()

    afterEach(async () => {
      if (serviceClose) {
        await serviceClose()
        serviceClose = null
      }

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

    async function startRenderer(options: { chromiumPool?: ChromiumPool } = {}) {
      dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-live-decks-'))
      cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-live-cache-'))
      const deckStore = createDeckStore(dataDir)
      previewSessionStore = createPreviewSessionStore()
      const app = createApp({
        deckStore,
        previewSessionStore,
        thumbnailService: createThumbnailService({
          cache: createThumbnailCache(cacheDir),
          deckStore,
          renderer: {
            isAvailable: () => false,
            render: async () => ({ ok: false, error: 'unused', durationMs: 0 }),
            close: async () => undefined,
          },
        }),
      })

      server = createServer(app)
      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject)
        server?.listen(0, '127.0.0.1', () => resolve())
      })

      const address = server.address() as AddressInfo
      const apiOrigin = `http://127.0.0.1:${address.port}`
      // createApp generates a process-local render secret; read it back so the
      // live Chromium page can authenticate against /api/thumbnail-render/*.
      const renderSecret = (app.locals.thumbnailRenderSecret as string | undefined) ?? ''
      const renderer = createThumbnailRenderer({
        previewSessionStore,
        apiOrigin,
        enabled: true,
        chromiumPool: options.chromiumPool,
        renderSecret,
      })
      serviceClose = () => renderer.close()
      return renderer
    }

    it('renders static decks into one png per slide', async () => {
      const renderer = await startRenderer()
      const result = await renderer.render({ html: plainCssDeck })

      expect(result.ok).toBe(true)
      if (!result.ok) {
        return
      }

      expect(result.slideCount).toBe(3)
      expect(result.slides).toHaveLength(3)
      for (const slide of result.slides) {
        expect(slide.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      }
    }, 60_000)

    it('closes page targets after each render (no tab leak)', async () => {
      const chromiumPool = createChromiumPool({ enabled: true })
      const renderer = await startRenderer({ chromiumPool })

      const first = await renderer.render({ html: plainCssDeck })
      expect(first.ok).toBe(true)
      const second = await renderer.render({ html: plainCssDeck })
      expect(second.ok).toBe(true)

      const browser = await chromiumPool.ensureBrowser()

      // Successful renders may keep one reused idle tab (about:blank) in
      // addition to Chromium's startup blank. Bound the pool so render tabs
      // never accumulate across jobs.
      await vi.waitFor(async () => {
        const targets = await listPageTargets(browser.debugPort)
        const pageTargets = targets.filter((target) => target.type === 'page')

        expect(pageTargets.length).toBeLessThanOrEqual(2)
        for (const target of pageTargets) {
          expect(target.url).not.toContain('/api/thumbnail-render/')
          expect(target.url ?? '').toMatch(/^(about:blank)?$/)
        }
      })
    }, 120_000)

    it('renders approved reveal decks', async () => {
      const renderer = await startRenderer()
      const result = await renderer.render({ html: revealRegistryDeck })

      expect(result.ok).toBe(true)
      if (!result.ok) {
        return
      }

      expect(result.slideCount).toBeGreaterThan(0)
      expect(result.slides).toHaveLength(result.slideCount)
    }, 60_000)

    it('fails safely on empty or slide-less decks', async () => {
      const renderer = await startRenderer()
      const empty = await renderer.render({ html: '<html><body></body></html>' })
      expect(empty.ok).toBe(false)
      if (!empty.ok) {
        expect(empty.error).toMatch(/no slides/i)
      }

      // Malformed fixture still recovers slides; ensure the renderer stays stable.
      const recovered = await renderer.render({ html: malformedDeck })
      expect(typeof recovered.ok).toBe('boolean')
    }, 60_000)

    it('contains hostile popup / form / navigation / object / iframe attempts without escaping', async () => {
      const chromiumPool = createChromiumPool({ enabled: true })
      const renderer = await startRenderer({ chromiumPool })
      const fixtures = [
        hostilePopupsDeck,
        hostileFormsDeck,
        hostileNavigationDeck,
        hostileObjectEmbedDeck,
        hostileIframesDeck,
      ]

      for (const html of fixtures) {
        const result = await renderer.render({ html })
        expect(typeof result.ok).toBe('boolean')
        expect(typeof result.durationMs).toBe('number')
        if (result.ok) {
          expect(result.slides.length).toBeGreaterThan(0)
        }
      }

      const browser = await chromiumPool.ensureBrowser()
      await vi.waitFor(async () => {
        const targets = await listPageTargets(browser.debugPort)
        const pageTargets = targets.filter((target) => target.type === 'page')
        // Reused idle tab + Chromium startup blank; no hostile navigations.
        expect(pageTargets.length).toBeLessThanOrEqual(2)
        for (const target of pageTargets) {
          expect(target.url).not.toMatch(/evil\.example/)
          expect(target.url ?? '').toMatch(/^(about:blank)?$/)
        }
      })
    }, 180_000)

    it('blocks or contains hostile external network attempts', async () => {
      const renderer = await startRenderer()

      for (const html of [hostileExternalFetchDeck, hostileSandboxNetworkDeck]) {
        const result = await renderer.render({ html })
        expect(typeof result.durationMs).toBe('number')

        if (result.ok) {
          expect(result.slides.length).toBeGreaterThan(0)
        } else {
          expect(result.error).toMatch(
            /blocked external network|Timed out|Thumbnail render failed/i,
          )
        }
      }
    }, 120_000)
  },
)

describe('thumbnail renderer availability', () => {
  it('reports unavailable under vitest unless explicitly forced on', () => {
    expect(process.env.VITEST).toBeTruthy()

    if (process.env.ARK_THUMBNAIL_RENDERER?.trim().toLowerCase() === 'on') {
      expect(isThumbnailRendererAvailable()).toBe(Boolean(findChromium()))
      return
    }

    expect(isThumbnailRendererAvailable()).toBe(false)
  })

  it('requires an explicit opt-in flag for live chromium coverage', () => {
    const requested =
      process.env.ARK_LIVE_CHROMIUM_TESTS === '1' ||
      process.env.ARK_LIVE_CHROMIUM_TESTS === 'true' ||
      process.env.ARK_LIVE_CHROMIUM_TESTS === 'on'
    expect(liveChromiumTestsEnabled).toBe(requested)
  })
})
