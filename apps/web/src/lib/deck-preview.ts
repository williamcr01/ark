import type { CSSProperties, IframeHTMLAttributes } from 'react'

import {
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck-core/deck-metadata.ts'
import { buildPreviewHtml, type PreviewHtmlOptions } from '@ark/deck-core/deck-preview-html.ts'
import { resolveAppOrigin } from '@ark/runtime-registry/sandbox-origin.ts'

/**
 * Defense-in-depth attrs for main/version preview iframes (not thumbnails):
 * empty Permissions-Policy allowlist + credentialless storage isolation.
 * `credentialless` is not yet in React's iframe attribute typings, so it is
 * passed as an empty string (boolean-attribute presence in the DOM).
 */
export const PREVIEW_IFRAME_SECURITY_PROPS = {
  allow: '',
  ...({ credentialless: '' } as IframeHTMLAttributes<HTMLIFrameElement>),
}

export {
  DECK_GOTO_EVENT,
  DECK_GOTO_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_EVENT,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
} from '@ark/deck-core/deck-bridge.ts'

export const PREVIEW_FRAME_WIDTH = ARK_SLIDE_REFERENCE_WIDTH
export const PREVIEW_FRAME_HEIGHT = ARK_SLIDE_REFERENCE_HEIGHT
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

export function getPreviewHtml(html: string, options: PreviewHtmlOptions = {}) {
  return buildPreviewHtml(html, {
    ...options,
    parentOrigin: options.parentOrigin ?? resolveAppOrigin(),
  })
}
