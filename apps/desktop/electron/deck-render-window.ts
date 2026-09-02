/**
 * The hidden-window render session shared by thumbnails and deck export.
 *
 * Both features need the same thing: a deck rendered at its reference size in a
 * throwaway Electron window that cannot reach the network, driven one slide at a
 * time through the render host's settle protocol. Only the per-slide work
 * differs - a PNG capture for thumbnails, a printToPDF for export - so the
 * window, its locked-down session, and the navigation loop live here while
 * callers supply what to do once a slide is on screen.
 */

import { randomUUID } from 'node:crypto'

import { BrowserWindow, session } from 'electron'
import type { PreviewSessionStore } from '@ark/storage/stores/preview-sessions.ts'
import { parseDeckHtml } from '@ark/deck-node/document/parser.ts'
import {
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck/document/metadata.ts'
import {
  buildThumbnailRenderUrl,
  renderThumbnailPreviewDocument,
  THUMBNAIL_RENDER_SECRET_HEADER,
} from '@ark/api/thumbnails/render-host.ts'
import {
  THUMBNAIL_READY_TIMEOUT_MS,
  THUMBNAIL_SETTLE_MS,
  THUMBNAIL_SLIDE_TIMEOUT_MS,
} from '@ark/api/thumbnails/constants.ts'

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Deck render aborted.')
}

class DeckRenderWaitTimeoutError extends Error {}

export class DeckRenderTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} timed out.`)
    this.name = 'DeckRenderTimeoutError'
  }
}

async function waitFor<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    throwIfAborted(signal)
    const value = await read()
    if (ready(value)) return value
    await sleep(10)
  }

  throw new DeckRenderWaitTimeoutError('Timed out waiting for the Electron deck renderer.')
}

type DeckRenderState = {
  ready: boolean
  index: number
  slideCount: number
  errors: string[]
}

function readState(window: BrowserWindow) {
  return window.webContents.executeJavaScript(
    `({
      ready: Boolean(window.__arkThumbReady),
      index: Number(window.__arkThumbIndex || 0),
      slideCount: Number(window.__arkThumbSlideCount || 0),
      errors: Array.isArray(window.__arkThumbErrors) ? window.__arkThumbErrors.slice() : []
    })`,
    true,
  ) as Promise<DeckRenderState>
}

/**
 * Navigate the render window to one slide and wait for it to settle.
 *
 * `label` names the caller in operator-facing errors, so a failed export does
 * not report itself as a thumbnail problem.
 */
export async function gotoDeckSlide(
  window: BrowserWindow,
  index: number,
  options: { label?: string; signal?: AbortSignal } = {},
) {
  const { label = 'Deck renderer', signal } = options
  const current = await readState(window)
  if (current.errors.length > 0) throw new Error(current.errors[0])

  if (current.index !== index) {
    const sent = (await window.webContents.executeJavaScript(
      `typeof window.__arkThumbGoto === 'function' && window.__arkThumbGoto(${index})`,
      true,
    )) as boolean
    if (!sent) throw new Error(`Could not navigate to slide ${index}.`)

    await waitFor(
      () => readState(window),
      (state) => {
        if (state.errors.length > 0) throw new Error(state.errors[0])
        return state.index === index
      },
      THUMBNAIL_SLIDE_TIMEOUT_MS,
      signal,
    )
  }

  const requestId = (await window.webContents.executeJavaScript(
    `typeof window.__arkThumbRequestSettle === 'function'
      ? window.__arkThumbRequestSettle(${index})
      : null`,
    true,
  )) as number | null

  if (!Number.isFinite(requestId)) {
    await sleep(THUMBNAIL_SETTLE_MS)
    return
  }

  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        `({
          settled: Number(window.__arkThumbSettledRequestId || 0) === ${requestId} &&
            Number(window.__arkThumbSettledIndex ?? -1) === ${index},
          errors: Array.isArray(window.__arkThumbErrors) ? window.__arkThumbErrors.slice() : []
        })`,
        true,
      ) as Promise<{ settled: boolean; errors: string[] }>,
    (state) => {
      if (state.errors.length > 0) throw new Error(state.errors[0])
      return state.settled
    },
    Math.max(THUMBNAIL_SETTLE_MS, 100),
    signal,
  ).catch(async (error) => {
    if (signal?.aborted) throw error
    if (!(error instanceof DeckRenderWaitTimeoutError)) throw error
    await sleep(THUMBNAIL_SETTLE_MS)
  })

  // The deck reports its own index, so the settled acknowledgement alone does
  // not prove the visible slide matches the requested one (deck scripts may
  // post CHANGE optimistically or auto-advance during settle). Fail the batch
  // instead of emitting a page that shows another slide.
  const verified = await readState(window)
  if (verified.errors.length > 0) throw new Error(verified.errors[0])
  if (verified.index !== index) {
    throw new Error(`${label} reached slide ${verified.index}, expected ${index}.`)
  }
}

export type DeckRenderWindowConfig = {
  apiOrigin: string
  previewSessionStore: PreviewSessionStore
  renderSecret: string
}

export type DeckRenderWindowLimits = {
  /** Names the caller in operator-facing errors, capitalised for sentence start. */
  label: string
  /** Refuse decks larger than this, with a message in the caller's vocabulary. */
  maxSlides: number
  /** Wall-clock budget before the window is destroyed. */
  timeoutMs: number
  /**
   * Offscreen compositing. Thumbnails need it so `capturePage` works on a window
   * that is never shown; `printToPDF` is unreliable against an offscreen target,
   * so export renders into a plain hidden window instead.
   */
  offscreen: boolean
}

export type DeckRenderWindowSession = {
  window: BrowserWindow
  slideCount: number
  slideIndexes: number[]
  /** Navigate to a slide and wait for it to settle. */
  gotoSlide: (index: number) => Promise<void>
}

/**
 * Render `html` in a locked-down hidden window and hand the settled session to
 * `run`. Throws on any render failure; the window, its session partition, and
 * the preview-session token are always torn down.
 */
function lockDeckRenderSession(config: DeckRenderWindowConfig, partition: string) {
  const renderSession = session.fromPartition(partition)
  renderSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  renderSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url)
      callback({
        cancel:
          url.protocol === 'http:' || url.protocol === 'https:'
            ? url.origin !== config.apiOrigin
            : !['data:', 'blob:', 'devtools:'].includes(url.protocol),
      })
    } catch {
      callback({ cancel: true })
    }
  })
  renderSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.startsWith(`${config.apiOrigin}/api/thumbnail-render/`)) {
      details.requestHeaders[THUMBNAIL_RENDER_SECRET_HEADER] = config.renderSecret
    }
    callback({ requestHeaders: details.requestHeaders })
  })
  return renderSession
}

export async function withDeckRenderWindow<T>(
  config: DeckRenderWindowConfig,
  request: { html: string; slideCount?: number; slideIndexes?: number[]; signal?: AbortSignal },
  limits: DeckRenderWindowLimits,
  run: (session: DeckRenderWindowSession) => Promise<T>,
): Promise<T> {
  const { signal } = request
  let previewSession: ReturnType<PreviewSessionStore['createSession']> | null = null
  let window: BrowserWindow | null = null
  let timeout: ReturnType<typeof setTimeout> | null = null

  try {
    throwIfAborted(signal)
    const slideCount = request.slideCount ?? parseDeckHtml(request.html).slideCount
    const slideIndexes =
      request.slideIndexes ?? Array.from({ length: slideCount }, (_value, index) => index)

    if (slideCount <= 0) throw new Error('Deck has no slides to render.')
    if (slideCount > limits.maxSlides) {
      throw new Error(
        `Deck has ${slideCount} slides; the ${limits.label.toLowerCase()} allows at most ${limits.maxSlides}.`,
      )
    }
    if (
      slideIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= slideCount)
    ) {
      throw new Error(`${limits.label} received an invalid slide index.`)
    }

    const thumbnailPreview = renderThumbnailPreviewDocument(request.html, {
      parentOrigin: config.apiOrigin,
    })
    previewSession = config.previewSessionStore.createSession(request.html, {
      thumbnailPreview: {
        html: thumbnailPreview.html,
        runtimeMode: thumbnailPreview.runtimeMode,
        nonce: thumbnailPreview.nonce,
      },
    })

    const partition = `ark-deck-render-${randomUUID()}`
    lockDeckRenderSession(config, partition)

    window = new BrowserWindow({
      show: false,
      width: ARK_SLIDE_REFERENCE_WIDTH,
      height: ARK_SLIDE_REFERENCE_HEIGHT,
      useContentSize: true,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: limits.offscreen,
        partition,
        sandbox: true,
        webSecurity: true,
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const renderWindow = window
    if (!previewSession) throw new Error('Deck renderer session was not created.')
    const renderPreview = previewSession

    let timedOut = false
    let settled = false
    let failWait: ((error: Error) => void) | null = null

    const abort = () => {
      renderWindow.destroy()
      if (!settled) failWait?.(new Error('Deck render aborted.'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    timeout = setTimeout(() => {
      timedOut = true
      renderWindow.destroy()
      if (!settled) failWait?.(new DeckRenderTimeoutError(limits.label))
    }, limits.timeoutMs)

    try {
      return await new Promise<T>((resolve, reject) => {
        failWait = reject
        void (async () => {
          await renderWindow.loadURL(buildThumbnailRenderUrl(config.apiOrigin, renderPreview.token))
          await waitFor(
            () => readState(renderWindow),
            (state) => {
              if (state.errors.length > 0) throw new Error(state.errors[0])
              return state.ready
            },
            THUMBNAIL_READY_TIMEOUT_MS,
            signal,
          )

          // Slide indexes come from a static parse of the source HTML; if the deck
          // reports a different slide count at runtime (dynamic full-JS decks that
          // mount or reorder slides), output would be misaligned with the source.
          // Fail instead.
          const readyState = await readState(renderWindow)
          if (readyState.slideCount > 0 && readyState.slideCount !== slideCount) {
            throw new Error(
              `Deck reports ${readyState.slideCount} slides at runtime; expected ${slideCount}.`,
            )
          }

          return await run({
            window: renderWindow,
            slideCount,
            slideIndexes,
            gotoSlide: (index: number) =>
              gotoDeckSlide(renderWindow, index, { label: limits.label, signal }),
          })
        })().then(
          (value) => {
            settled = true
            resolve(value)
          },
          (error) => {
            settled = true
            if (signal?.aborted) reject(new Error('Deck render aborted.'))
            else if (timedOut) reject(new DeckRenderTimeoutError(limits.label))
            else reject(error)
          },
        )
      })
    } finally {
      settled = true
      signal?.removeEventListener('abort', abort)
    }
  } finally {
    if (timeout) clearTimeout(timeout)
    if (window && !window.isDestroyed()) window.destroy()
    if (previewSession) config.previewSessionStore.deleteSession(previewSession.token)
  }
}
