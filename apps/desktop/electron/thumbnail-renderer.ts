import type { PreviewSessionStore } from '@ark/storage/stores/preview-sessions.ts'
import {
  THUMBNAIL_RENDER_ABORTED_ERROR,
  type ThumbnailRenderer,
} from '@ark/api/thumbnails/renderer.ts'
import {
  THUMBNAIL_DECK_TIMEOUT_MS,
  THUMBNAIL_MAX_PNG_BYTES,
  THUMBNAIL_MAX_SLIDES,
  THUMBNAIL_OUTPUT_HEIGHT,
  THUMBNAIL_OUTPUT_WIDTH,
} from '@ark/api/thumbnails/constants.ts'

import { throwIfAborted, withDeckRenderWindow } from './deck-render-window.ts'

const THUMBNAIL_RENDER_LABEL = 'Thumbnail renderer'

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

      try {
        return await withDeckRenderWindow(
          options,
          request,
          {
            label: THUMBNAIL_RENDER_LABEL,
            maxSlides: THUMBNAIL_MAX_SLIDES,
            timeoutMs: THUMBNAIL_DECK_TIMEOUT_MS,
            offscreen: true,
          },
          async ({ window, slideCount, slideIndexes, gotoSlide }) => {
            const slides: Buffer[] = []

            for (const index of slideIndexes) {
              throwIfAborted(signal)
              // react-doctor-disable-next-line react-doctor/async-await-in-loop -- sequential by design: each slide must be navigated to and settled before its capture can run (ordered side effects + per-slide abort checks)
              await gotoSlide(index)
              const png = (await window.webContents.capturePage())
                .resize({ width: THUMBNAIL_OUTPUT_WIDTH, height: THUMBNAIL_OUTPUT_HEIGHT })
                .toPNG()
              if (png.byteLength > THUMBNAIL_MAX_PNG_BYTES) {
                throw new Error(`Slide ${index} thumbnail exceeds the PNG size limit.`)
              }
              slides.push(png)
            }

            return {
              ok: true as const,
              slides,
              slideCount,
              width: THUMBNAIL_OUTPUT_WIDTH,
              height: THUMBNAIL_OUTPUT_HEIGHT,
              durationMs: Date.now() - startedAt,
            }
          },
        )
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
      }
    },
  }
}
