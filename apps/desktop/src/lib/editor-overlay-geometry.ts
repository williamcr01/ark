import type { EditorNormalizedRect } from '@ark/editor-runtime'
import { PREVIEW_FRAME_HEIGHT, PREVIEW_FRAME_WIDTH } from '@/lib/deck-preview'

export type StagePixelRect = {
  left: number
  top: number
  width: number
  height: number
}

/** Full-stage slide bounds when the slide fills the iframe viewport. */
export const FULL_STAGE_SLIDE_BOUNDS: EditorNormalizedRect = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
}

/**
 * Map slide-relative normalized geometry (0–1) to pixels inside the scaled
 * preview stage. When `slideBounds` is provided (viewport-normalized slide
 * box), compose so letterboxed / scaled slides align with the parent overlay.
 */
export function normalizedRectToStagePixels(
  geometry: EditorNormalizedRect,
  scale: number,
  slideBounds: EditorNormalizedRect = FULL_STAGE_SLIDE_BOUNDS,
): StagePixelRect {
  const width = PREVIEW_FRAME_WIDTH * scale
  const height = PREVIEW_FRAME_HEIGHT * scale
  const bounds =
    slideBounds.width > 0 && slideBounds.height > 0 ? slideBounds : FULL_STAGE_SLIDE_BOUNDS

  return {
    left: (bounds.x + geometry.x * bounds.width) * width,
    top: (bounds.y + geometry.y * bounds.height) * height,
    width: Math.max(geometry.width * bounds.width * width, 2),
    height: Math.max(geometry.height * bounds.height * height, 2),
  }
}
