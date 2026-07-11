import { resolveApiOrigin } from '@ark/runtime-registry/sandbox-origin.ts'
import { type PreviewSessionStore } from '../preview-sessions.ts'
import { parseDeckHtml } from '../deck-parser.ts'
import { createLogger, type Logger } from '../observability/logger.ts'
import {
  createChromiumPool,
  evaluate,
  isThumbnailRendererAvailable,
  type BrowserPage,
  type ChromiumPool,
  type CdpClient,
} from './chromium.ts'
import {
  THUMBNAIL_DECK_TIMEOUT_MS,
  THUMBNAIL_MAX_PNG_BYTES,
  THUMBNAIL_MAX_SLIDES,
  THUMBNAIL_OUTPUT_HEIGHT,
  THUMBNAIL_OUTPUT_WIDTH,
  THUMBNAIL_READY_TIMEOUT_MS,
  THUMBNAIL_SETTLE_MS,
  THUMBNAIL_SLIDE_TIMEOUT_MS,
  THUMBNAIL_VIEWPORT_HEIGHT,
  THUMBNAIL_VIEWPORT_WIDTH,
} from './constants.ts'
import { buildThumbnailRenderUrl, THUMBNAIL_RENDER_SECRET_HEADER } from './render-host.ts'

export type ThumbnailRenderRequest = {
  html: string
  deckId?: string
  versionId?: string
}

export type ThumbnailRenderSuccess = {
  ok: true
  slides: Buffer[]
  slideCount: number
  width: number
  height: number
  durationMs: number
}

export type ThumbnailRenderFailure = {
  ok: false
  error: string
  durationMs: number
}

export type ThumbnailRenderResult = ThumbnailRenderSuccess | ThumbnailRenderFailure

export type ThumbnailRendererLimits = {
  maxSlides?: number
  maxPngBytes?: number
  deckTimeoutMs?: number
  readyTimeoutMs?: number
  slideTimeoutMs?: number
  settleMs?: number
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${label}.`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

async function waitForDeckReady(cdp: CdpClient, timeoutMs: number) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const state = await evaluate<{
      ready: boolean
      slideCount: number
      index: number
      errors: string[]
    }>(
      cdp,
      `({
        ready: Boolean(window.__arkThumbReady),
        slideCount: Number(window.__arkThumbSlideCount || 0),
        index: Number(window.__arkThumbIndex || 0),
        errors: Array.isArray(window.__arkThumbErrors) ? window.__arkThumbErrors.slice() : [],
      })`,
    )

    if (state.errors.length > 0) {
      throw new Error(state.errors[0] ?? 'Deck runtime error during thumbnail render.')
    }

    if (state.ready) {
      return state
    }

    await sleep(50)
  }

  throw new Error('Timed out waiting for deck ready during thumbnail render.')
}

function buildRuntimeError(error: string | undefined) {
  return new Error(error ?? 'Deck runtime error during thumbnail render.')
}

async function waitForSlideSettle(cdp: CdpClient, index: number, settleMs: number) {
  if (settleMs <= 0) {
    return
  }

  const requestId = await evaluate<number | null>(
    cdp,
    `typeof window.__arkThumbRequestSettle === 'function' ? window.__arkThumbRequestSettle(${index}) : null`,
  )

  if (!Number.isFinite(requestId)) {
    await sleep(settleMs)
    return
  }

  const startedAt = Date.now()

  while (Date.now() - startedAt < settleMs) {
    const state = await evaluate<{
      settled: boolean
      errors: string[]
    }>(
      cdp,
      `({
        settled:
          Number(window.__arkThumbSettledRequestId || 0) === ${requestId} &&
          Number(window.__arkThumbSettledIndex || -1) === ${index},
        errors: Array.isArray(window.__arkThumbErrors) ? window.__arkThumbErrors.slice() : [],
      })`,
    )

    if (state.errors.length > 0) {
      throw buildRuntimeError(state.errors[0])
    }

    if (state.settled) {
      return
    }

    await sleep(Math.min(20, Math.max(1, settleMs - (Date.now() - startedAt))))
  }
}

async function gotoSlide(cdp: CdpClient, index: number, slideTimeoutMs: number, settleMs: number) {
  const sent = await evaluate<boolean>(
    cdp,
    `typeof window.__arkThumbGoto === 'function' ? window.__arkThumbGoto(${index}) : false`,
  )

  if (!sent) {
    throw new Error(`Could not post goto for slide ${index}.`)
  }

  const startedAt = Date.now()

  while (Date.now() - startedAt < slideTimeoutMs) {
    const state = await evaluate<{
      current: number
      errors: string[]
    }>(
      cdp,
      `({
        current: Number(window.__arkThumbIndex || 0),
        errors: Array.isArray(window.__arkThumbErrors) ? window.__arkThumbErrors.slice() : [],
      })`,
    )

    if (state.errors.length > 0) {
      throw buildRuntimeError(state.errors[0])
    }

    if (state.current === index) {
      await waitForSlideSettle(cdp, index, settleMs)
      return
    }

    await sleep(40)
  }

  throw new Error(`Timed out waiting for slide ${index} during thumbnail render.`)
}

async function captureSlidePng(cdp: CdpClient, maxPngBytes: number) {
  const result = await cdp.send<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })

  const png = Buffer.from(result.data, 'base64')

  if (png.byteLength === 0) {
    throw new Error('Thumbnail screenshot was empty.')
  }

  if (png.byteLength > maxPngBytes) {
    throw new Error(
      `Thumbnail screenshot exceeded size limit (${png.byteLength} > ${maxPngBytes}).`,
    )
  }

  return png
}

/** Exported for unit tests of the post-hoc network allowlist. */
export function collectExternalNetworkRequests(
  requests: Array<{ url: string }>,
  apiOrigin: string,
) {
  const allowedOrigin = apiOrigin.replace(/\/+$/, '')

  return requests.filter((request) => {
    try {
      const url = new URL(request.url)

      if (url.protocol === 'data:' || url.protocol === 'blob:') {
        return false
      }

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false
      }

      return url.origin !== allowedOrigin
    } catch {
      return true
    }
  })
}

export type ThumbnailRenderer = {
  isAvailable: () => boolean
  render: (request: ThumbnailRenderRequest) => Promise<ThumbnailRenderResult>
  close: () => Promise<void>
}

export function createThumbnailRenderer(options: {
  previewSessionStore: PreviewSessionStore
  chromiumPool?: ChromiumPool
  apiOrigin?: string
  logger?: Logger
  enabled?: boolean
  /** Process-local secret required by /api/thumbnail-render/* (blocks Vite-proxy bypass). */
  renderSecret: string
  /** Internal test seam; production uses the configured defaults. */
  limits?: ThumbnailRendererLimits
}): ThumbnailRenderer {
  const logger = options.logger ?? createLogger({ service: 'ark-api' })
  const enabled = options.enabled ?? isThumbnailRendererAvailable()
  const chromiumPool = options.chromiumPool ?? createChromiumPool({ enabled })
  const apiOrigin = options.apiOrigin ?? resolveApiOrigin()
  const { renderSecret } = options
  const maxSlides = options.limits?.maxSlides ?? THUMBNAIL_MAX_SLIDES
  const maxPngBytes = options.limits?.maxPngBytes ?? THUMBNAIL_MAX_PNG_BYTES
  const deckTimeoutMs = options.limits?.deckTimeoutMs ?? THUMBNAIL_DECK_TIMEOUT_MS
  const readyTimeoutMs = options.limits?.readyTimeoutMs ?? THUMBNAIL_READY_TIMEOUT_MS
  const slideTimeoutMs = options.limits?.slideTimeoutMs ?? THUMBNAIL_SLIDE_TIMEOUT_MS
  const settleMs = options.limits?.settleMs ?? THUMBNAIL_SETTLE_MS

  return {
    isAvailable: () => enabled && chromiumPool.isAvailable(),
    async close() {
      await chromiumPool.close()
    },
    async render(request) {
      const startedAt = Date.now()

      if (!enabled || !chromiumPool.isAvailable()) {
        return {
          ok: false,
          error: 'Thumbnail renderer is disabled.',
          durationMs: Date.now() - startedAt,
        }
      }

      const parsed = parseDeckHtml(request.html)
      const slideCount = parsed.slideCount

      if (slideCount <= 0) {
        return {
          ok: false,
          error: 'Deck has no slides to render.',
          durationMs: Date.now() - startedAt,
        }
      }

      if (slideCount > maxSlides) {
        return {
          ok: false,
          error: `Deck has ${slideCount} slides; thumbnail renderer allows at most ${maxSlides}.`,
          durationMs: Date.now() - startedAt,
        }
      }

      const session = options.previewSessionStore.createSession(request.html)
      const renderUrl = buildThumbnailRenderUrl(apiOrigin, session.token)
      const pageRef: { current: BrowserPage | null } = { current: null }
      const networkRequests: Array<{ url: string }> = []

      try {
        const result = await withTimeout(
          (async (): Promise<ThumbnailRenderSuccess> => {
            const page = await chromiumPool.createPage()
            pageRef.current = page
            const { cdp } = page

            await cdp.send('Page.enable')
            await cdp.send('Runtime.enable')
            await cdp.send('Network.enable')

            // Attach the process-local secret to every request from this page
            // (host document + sandboxed iframe) so the Vite reverse proxy
            // cannot be used to reach the render routes without it.
            await cdp.send('Network.setExtraHTTPHeaders', {
              headers: {
                [THUMBNAIL_RENDER_SECRET_HEADER]: renderSecret,
              },
            })

            cdp.on('Network.requestWillBeSent', (params) => {
              const url = (params as { request?: { url?: string } })?.request?.url
              if (url) {
                networkRequests.push({ url })
              }
            })

            await cdp.send('Emulation.setDeviceMetricsOverride', {
              width: THUMBNAIL_VIEWPORT_WIDTH,
              height: THUMBNAIL_VIEWPORT_HEIGHT,
              deviceScaleFactor: THUMBNAIL_OUTPUT_WIDTH / THUMBNAIL_VIEWPORT_WIDTH,
              mobile: false,
            })

            await cdp.send('Page.navigate', { url: renderUrl })
            await cdp.waitForEvent('Page.loadEventFired', () => true, readyTimeoutMs)
            await waitForDeckReady(cdp, readyTimeoutMs)

            const slides: Buffer[] = []

            for (let index = 0; index < slideCount; index += 1) {
              await withTimeout(
                gotoSlide(cdp, index, slideTimeoutMs, settleMs),
                slideTimeoutMs,
                `slide ${index}`,
              )
              const png = await withTimeout(
                captureSlidePng(cdp, maxPngBytes),
                slideTimeoutMs,
                `screenshot ${index}`,
              )
              slides.push(png)
            }

            // Post-hoc defense-in-depth only: the injected sandbox CSP is what
            // actually blocks external requests. This check runs after capture
            // (so a request would already have been attempted) and may miss
            // subframe traffic if the sandboxed iframe ever becomes an
            // out-of-process frame; it exists to surface CSP regressions.
            const external = collectExternalNetworkRequests(networkRequests, apiOrigin)

            if (external.length > 0) {
              throw new Error(
                `Thumbnail render blocked external network request: ${external[0]?.url}`,
              )
            }

            return {
              ok: true,
              slides,
              slideCount,
              width: THUMBNAIL_OUTPUT_WIDTH,
              height: THUMBNAIL_OUTPUT_HEIGHT,
              durationMs: Date.now() - startedAt,
            }
          })(),
          deckTimeoutMs,
          'deck thumbnail render',
        )

        logger.info('thumbnail.render.succeeded', {
          deckId: request.deckId ?? null,
          fields: {
            versionId: request.versionId ?? null,
            slideCount: result.slideCount,
            durationMs: result.durationMs,
          },
        })

        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Thumbnail render failed.'

        logger.warn('thumbnail.render.failed', {
          deckId: request.deckId ?? null,
          fields: {
            versionId: request.versionId ?? null,
            error: message,
            durationMs: Date.now() - startedAt,
          },
        })

        return {
          ok: false,
          error: message,
          durationMs: Date.now() - startedAt,
        }
      } finally {
        options.previewSessionStore.deleteSession(session.token)
        // Dispose the tab (not just the CDP socket) so the shared browser does
        // not accumulate one open page per render.
        await pageRef.current?.close().catch(() => undefined)
      }
    },
  }
}
