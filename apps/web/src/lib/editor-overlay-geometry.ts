import type { EditorNormalizedRect } from '@ark/deck-core/deck-editor-bridge.ts'
import { PREVIEW_FRAME_HEIGHT, PREVIEW_FRAME_WIDTH } from '@/lib/deck-preview'

export type StagePixelRect = {
  left: number
  top: number
  width: number
  height: number
}

/** Map normalized slide geometry (0–1) to pixels inside the scaled preview stage. */
export function normalizedRectToStagePixels(
  geometry: EditorNormalizedRect,
  scale: number,
): StagePixelRect {
  const width = PREVIEW_FRAME_WIDTH * scale
  const height = PREVIEW_FRAME_HEIGHT * scale

  return {
    left: geometry.x * width,
    top: geometry.y * height,
    width: Math.max(geometry.width * width, 2),
    height: Math.max(geometry.height * height, 2),
  }
}
