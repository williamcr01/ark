import { randomUUID } from 'node:crypto'

import { BrowserWindow, session } from 'electron'
import type { PreviewSessionStore } from '@ark/api/preview-sessions.ts'
import { parseDeckHtml } from '@ark/api/deck-parser.ts'
import {
  THUMBNAIL_RENDER_ABORTED_ERROR,
  type ThumbnailRenderer,
} from '@ark/api/thumbnails/renderer.ts'
import {
  buildThumbnailRenderUrl,
  renderThumbnailPreviewDocument,
  THUMBNAIL_RENDER_SECRET_HEADER,
} from '@ark/api/thumbnails/render-host.ts'
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
} from '@ark/api/thumbnails/constants.ts'

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error(THUMBNAIL_RENDER_ABORTED_ERROR)
}

class ThumbnailWaitTimeoutError extends Error {}

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

  throw new ThumbnailWaitTimeoutError('Timed out waiting for the Electron thumbnail renderer.')
}

type ThumbnailState = {
  ready: boolean
  index: number
  errors: string[]
}

function readState(window: BrowserWindow) {
  return window.webContents.executeJavaScript(
    `({
      ready: Boolean(window.__arkThumbReady),
      index: Number(window.__arkThumbIndex || 0),
      errors: Array.isArray(window.__arkThumbErrors) ? window.__arkThumbErrors.slice() : []
    })`,
    true,
  ) as Promise<ThumbnailState>
}

export async function gotoThumbnailSlide(
  window: BrowserWindow,
  index: number,
  signal?: AbortSignal,
) {
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
    if (!(error instanceof ThumbnailWaitTimeoutError)) throw error
    await sleep(THUMBNAIL_SETTLE_MS)
  })
}

export function createElectronThumbnailRenderer(options: {
  apiOrigin: string
  previewSessionStore: PreviewSessionStore
  renderSecret: string
}): ThumbnailRenderer {
  return {
    isAvailable: () => true,
    close: async () => undefined,
    async render(request) {
      const startedAt = Date.now()
      const signal = request.signal
      let previewSession: ReturnType<PreviewSessionStore['createSession']> | null = null
      let window: BrowserWindow | null = null
      let timeout: ReturnType<typeof setTimeout> | null = null

      try {
        throwIfAborted(signal)
        const slideCount = request.slideCount ?? parseDeckHtml(request.html).slideCount
        const slideIndexes =
          request.slideIndexes ?? Array.from({ length: slideCount }, (_value, index) => index)

        if (slideCount <= 0) throw new Error('Deck has no slides to render.')
        if (slideCount > THUMBNAIL_MAX_SLIDES) {
          throw new Error(
            `Deck has ${slideCount} slides; thumbnail renderer allows at most ${THUMBNAIL_MAX_SLIDES}.`,
          )
        }
        if (
          slideIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= slideCount)
        ) {
          throw new Error('Thumbnail renderer received an invalid slide index.')
        }

        const thumbnailPreview = renderThumbnailPreviewDocument(request.html, {
          parentOrigin: options.apiOrigin,
        })
        previewSession = options.previewSessionStore.createSession(request.html, {
          thumbnailPreview: {
            html: thumbnailPreview.html,
            runtimeMode: thumbnailPreview.runtimeMode,
            nonce: thumbnailPreview.nonce,
          },
        })

        const partition = `ark-thumbnail-${randomUUID()}`
        const thumbnailSession = session.fromPartition(partition)
        thumbnailSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
          callback(false)
        })
        thumbnailSession.webRequest.onBeforeRequest((details, callback) => {
          try {
            const url = new URL(details.url)
            callback({
              cancel:
                url.protocol === 'http:' || url.protocol === 'https:'
                  ? url.origin !== options.apiOrigin
                  : !['data:', 'blob:', 'devtools:'].includes(url.protocol),
            })
          } catch {
            callback({ cancel: true })
          }
        })
        thumbnailSession.webRequest.onBeforeSendHeaders((details, callback) => {
          if (details.url.startsWith(`${options.apiOrigin}/api/thumbnail-render/`)) {
            details.requestHeaders[THUMBNAIL_RENDER_SECRET_HEADER] = options.renderSecret
          }
          callback({ requestHeaders: details.requestHeaders })
        })

        window = new BrowserWindow({
          show: false,
          width: THUMBNAIL_VIEWPORT_WIDTH,
          height: THUMBNAIL_VIEWPORT_HEIGHT,
          useContentSize: true,
          webPreferences: {
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
            partition,
            sandbox: true,
            webSecurity: true,
          },
        })
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

        const abort = () => window?.destroy()
        signal?.addEventListener('abort', abort, { once: true })
        timeout = setTimeout(() => window?.destroy(), THUMBNAIL_DECK_TIMEOUT_MS)

        try {
          await window.loadURL(buildThumbnailRenderUrl(options.apiOrigin, previewSession.token))
          await waitFor(
            () => readState(window!),
            (state) => {
              if (state.errors.length > 0) throw new Error(state.errors[0])
              return state.ready
            },
            THUMBNAIL_READY_TIMEOUT_MS,
            signal,
          )

          const slides: Buffer[] = []
          for (const index of slideIndexes) {
            throwIfAborted(signal)
            await gotoThumbnailSlide(window, index, signal)
            const png = (await window.webContents.capturePage())
              .resize({ width: THUMBNAIL_OUTPUT_WIDTH, height: THUMBNAIL_OUTPUT_HEIGHT })
              .toPNG()
            if (png.byteLength > THUMBNAIL_MAX_PNG_BYTES) {
              throw new Error(`Slide ${index} thumbnail exceeds the PNG size limit.`)
            }
            slides.push(png)
          }

          return {
            ok: true,
            slides,
            slideCount,
            width: THUMBNAIL_OUTPUT_WIDTH,
            height: THUMBNAIL_OUTPUT_HEIGHT,
            durationMs: Date.now() - startedAt,
          }
        } finally {
          signal?.removeEventListener('abort', abort)
        }
      } catch (error) {
        const aborted = Boolean(signal?.aborted)
        return {
          ok: false,
          error: aborted
            ? THUMBNAIL_RENDER_ABORTED_ERROR
            : error instanceof Error
              ? error.message
              : 'Thumbnail render failed.',
          durationMs: Date.now() - startedAt,
          aborted,
        }
      } finally {
        if (timeout) clearTimeout(timeout)
        if (window && !window.isDestroyed()) window.destroy()
        if (previewSession) options.previewSessionStore.deleteSession(previewSession.token)
      }
    },
  }
}
