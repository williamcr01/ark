import { describe, expect, it } from 'vitest'

import { PREVIEW_FRAME_HEIGHT, PREVIEW_FRAME_WIDTH } from '@/lib/deck/deck-preview'
import {
  FULL_STAGE_SLIDE_BOUNDS,
  normalizedRectToStagePixels,
} from '@/lib/editor/editor-overlay-geometry'

describe('normalizedRectToStagePixels', () => {
  const geometry = { x: 0.1, y: 0.2, width: 0.5, height: 0.25 }

  it('maps slide-relative geometry onto the full stage when bounds fill the viewport', () => {
    expect(normalizedRectToStagePixels(geometry, 1)).toEqual({
      left: geometry.x * PREVIEW_FRAME_WIDTH,
      top: geometry.y * PREVIEW_FRAME_HEIGHT,
      width: geometry.width * PREVIEW_FRAME_WIDTH,
      height: geometry.height * PREVIEW_FRAME_HEIGHT,
    })
    expect(normalizedRectToStagePixels(geometry, 1, FULL_STAGE_SLIDE_BOUNDS)).toEqual({
      left: geometry.x * PREVIEW_FRAME_WIDTH,
      top: geometry.y * PREVIEW_FRAME_HEIGHT,
      width: geometry.width * PREVIEW_FRAME_WIDTH,
      height: geometry.height * PREVIEW_FRAME_HEIGHT,
    })
  })

  it('composes letterboxed slideBounds into stage pixels', () => {
    const insetX = PREVIEW_FRAME_WIDTH * 0.1
    const insetY = PREVIEW_FRAME_HEIGHT * 0.1
    const slideWidth = PREVIEW_FRAME_WIDTH * 0.8
    const slideHeight = PREVIEW_FRAME_HEIGHT * 0.8
    const slideBounds = {
      x: insetX / PREVIEW_FRAME_WIDTH,
      y: insetY / PREVIEW_FRAME_HEIGHT,
      width: slideWidth / PREVIEW_FRAME_WIDTH,
      height: slideHeight / PREVIEW_FRAME_HEIGHT,
    }
    const result = normalizedRectToStagePixels(geometry, 1, slideBounds)

    expect(result.left).toBeCloseTo(insetX + geometry.x * slideWidth)
    expect(result.top).toBeCloseTo(insetY + geometry.y * slideHeight)
    expect(result.width).toBeCloseTo(geometry.width * slideWidth)
    expect(result.height).toBeCloseTo(geometry.height * slideHeight)
  })

  it('scales composed geometry with the preview frame scale', () => {
    const slideBounds = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
    const scale = 0.5

    expect(normalizedRectToStagePixels(geometry, scale, slideBounds)).toEqual({
      left: (0.1 + geometry.x * 0.8) * PREVIEW_FRAME_WIDTH * scale,
      top: (0.1 + geometry.y * 0.8) * PREVIEW_FRAME_HEIGHT * scale,
      width: geometry.width * 0.8 * PREVIEW_FRAME_WIDTH * scale,
      height: geometry.height * 0.8 * PREVIEW_FRAME_HEIGHT * scale,
    })
  })

  it('falls back to full-stage bounds when slideBounds has a zero axis', () => {
    expect(
      normalizedRectToStagePixels(geometry, 1, { x: 0.1, y: 0.1, width: 0, height: 0.8 }),
    ).toEqual(normalizedRectToStagePixels(geometry, 1))
  })
})
