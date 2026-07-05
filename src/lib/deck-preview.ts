import type { CSSProperties } from 'react'

import { buildPreviewHtml, type PreviewHtmlOptions } from '../../shared/deck-preview-html.ts'
import { resolveAppOrigin } from '../../shared/sandbox-origin.ts'
import type { DeckRuntimeMode } from '@/lib/deck-runtime'
import { detectRuntimeMode } from '@/lib/deck-runtime'

export {
  DECK_GOTO_EVENT,
  DECK_GOTO_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_EVENT,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
} from '../../shared/deck-bridge.ts'

export const PREVIEW_FRAME_WIDTH = 1600
export const PREVIEW_FRAME_HEIGHT = 900
export const PREVIEW_FRAME_ASPECT_RATIO = `${PREVIEW_FRAME_WIDTH} / ${PREVIEW_FRAME_HEIGHT}`

export type ElementSize = {
  width: number
  height: number
}

export function getPreviewFrameScale({ width, height }: ElementSize) {
  const scale = Math.min(width / PREVIEW_FRAME_WIDTH, height / PREVIEW_FRAME_HEIGHT)

  if (!Number.isFinite(scale) || scale <= 0) {
    return 0
  }

  return scale
}

export function getPreviewStageStyle(scale: number): CSSProperties {
  if (scale <= 0) {
    return {
      aspectRatio: PREVIEW_FRAME_ASPECT_RATIO,
      width: '100%',
      maxHeight: '100%',
    }
  }

  return {
    width: PREVIEW_FRAME_WIDTH * scale,
    height: PREVIEW_FRAME_HEIGHT * scale,
  }
}

export function getPreviewFrameStyle(scale: number): CSSProperties {
  return {
    width: PREVIEW_FRAME_WIDTH,
    height: PREVIEW_FRAME_HEIGHT,
    transform: `scale(${scale || 1})`,
    transformOrigin: 'top left',
    visibility: scale > 0 ? 'visible' : 'hidden',
  }
}

export type { DeckRuntimeMode } from '@/lib/deck-runtime'

export { detectRuntimeMode, getPreviewSandbox, getThumbnailSandbox } from '@/lib/deck-runtime'

/** @deprecated Use {@link detectRuntimeMode} instead. */
export function detectPreviewMode(html: string): DeckRuntimeMode {
  return detectRuntimeMode(html)
}

export function getPreviewHtml(html: string, options: PreviewHtmlOptions = {}) {
  return buildPreviewHtml(html, {
    parentOrigin: options.parentOrigin ?? resolveAppOrigin(),
  })
}

export function useSrcDocPreviewFallback() {
  return import.meta.env.VITE_ARK_PREVIEW_SRCDOC === 'true'
}
