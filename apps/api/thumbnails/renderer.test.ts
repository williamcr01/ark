import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { createApp } from '../app.ts'
import { createDeckStore } from '../deck-store.ts'
import { createPreviewSessionStore } from '../preview-sessions.ts'
import { createThumbnailCache } from './cache.ts'
import { findChromium, isThumbnailRendererAvailable } from './chromium.ts'
import { createThumbnailRenderer } from './renderer.ts'
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
const malformedDeck = readFileSync(path.join(fixtureDir, 'malformed-deck.html'), 'utf8')

const chromiumAvailable = Boolean(findChromium())

describe.runIf(chromiumAvailable)('thumbnail renderer (live chromium)', () => {
  let dataDir = ''
  let cacheDir = ''
  let server: Server | null = null
  let serviceClose: (() => Promise<void>) | null = null

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

  async function startRenderer() {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-live-decks-'))
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-live-cache-'))
    const deckStore = createDeckStore(dataDir)
    const previewSessionStore = createPreviewSessionStore()
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
    const renderer = createThumbnailRenderer({
      previewSessionStore,
      apiOrigin,
      enabled: true,
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

    // Malformed fixture still recovers slides; ensure the renderer stays stable.
    const recovered = await renderer.render({ html: malformedDeck })
    expect(typeof recovered.ok).toBe('boolean')
  }, 60_000)

  it('contains hostile external fetch / popup / form / navigation / object attempts', async () => {
    const renderer = await startRenderer()
    const fixtures = [
      hostileExternalFetchDeck,
      hostilePopupsDeck,
      hostileFormsDeck,
      hostileNavigationDeck,
      hostileObjectEmbedDeck,
    ]

    for (const html of fixtures) {
      const result = await renderer.render({ html })
      // Either a clean render with no external network, or a failed render —
      // never an uncaught crash / process exit.
      expect(typeof result.ok).toBe('boolean')
      expect(typeof result.durationMs).toBe('number')
    }
  }, 120_000)
})

describe('thumbnail renderer availability', () => {
  it('reports unavailable under vitest by default', () => {
    expect(process.env.VITEST).toBeTruthy()
    expect(isThumbnailRendererAvailable()).toBe(false)
  })
})
