import { describe, expect, it } from 'vitest'

import { FULL_STAGE_SLIDE_BOUNDS, normalizedRectToStagePixels } from '@/lib/editor-overlay-geometry'

describe('normalizedRectToStagePixels', () => {
  const geometry = { x: 0.1, y: 0.2, width: 0.5, height: 0.25 }

  it('maps slide-relative geometry onto the full stage when bounds fill the viewport', () => {
    expect(normalizedRectToStagePixels(geometry, 1)).toEqual({
      left: 160,
      top: 180,
      width: 800,
      height: 225,
    })
    expect(normalizedRectToStagePixels(geometry, 1, FULL_STAGE_SLIDE_BOUNDS)).toEqual({
      left: 160,
      top: 180,
      width: 800,
      height: 225,
    })
  })

  it('composes letterboxed slideBounds into stage pixels', () => {
    // Slide centered at 1280×720 inside 1600×900 → offset (160, 90).
    const slideBounds = {
      x: 160 / 1600,
      y: 90 / 900,
      width: 1280 / 1600,
      height: 720 / 900,
    }
    const result = normalizedRectToStagePixels(geometry, 1, slideBounds)

    expect(result.left).toBeCloseTo(160 + 0.1 * 1280)
    expect(result.top).toBeCloseTo(90 + 0.2 * 720)
    expect(result.width).toBeCloseTo(0.5 * 1280)
    expect(result.height).toBeCloseTo(0.25 * 720)
  })

  it('scales composed geometry with the preview frame scale', () => {
    const slideBounds = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
    const scale = 0.5

    expect(normalizedRectToStagePixels(geometry, scale, slideBounds)).toEqual({
      left: (0.1 + 0.1 * 0.8) * 1600 * scale,
      top: (0.1 + 0.2 * 0.8) * 900 * scale,
      width: 0.5 * 0.8 * 1600 * scale,
      height: 0.25 * 0.8 * 900 * scale,
    })
  })

  it('falls back to full-stage bounds when slideBounds has a zero axis', () => {
    expect(
      normalizedRectToStagePixels(geometry, 1, { x: 0.1, y: 0.1, width: 0, height: 0.8 }),
    ).toEqual(normalizedRectToStagePixels(geometry, 1))
  })
})
