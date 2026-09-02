import { describe, expect, it } from 'vitest'

import {
  ACTIVE_MOUNT_RADIUS,
  MAX_MOUNTED_THUMBNAILS,
  THUMBNAIL_MOUNT_BUFFER,
  altArrowReorderDelta,
  clampSlideIndex,
  computeDropToIndex,
  computeInsertionIndex,
  computeMountedIndices,
  computePreviewOffset,
  computeReorderDestination,
  pointerCoordinate,
  previewTransformStyle,
  previewTranslationCss,
  resolveThumbnailKeyboardAction,
} from './thumbnail-strip'

function stackedBounds(count: number, height = 100, gap = 8) {
  return Array.from({ length: count }, (_, index) => {
    const top = index * (height + gap)
    return { height, left: 0, top, width: 152 }
  })
}

describe('computeMountedIndices', () => {
  it('mounts a buffered window around the active slide when nothing is visible yet', () => {
    const mounted = computeMountedIndices(3, 1, new Set())

    expect(mounted).toEqual(new Set([0, 1, 2]))
  })

  it('expands around the visible range and always keeps slide 0', () => {
    const mounted = computeMountedIndices(20, 10, new Set([8, 9, 10]))

    expect(mounted.has(0)).toBe(true)
    expect(Math.min(...mounted)).toBe(0)
    expect(Math.max(...mounted)).toBe(10 + THUMBNAIL_MOUNT_BUFFER)
    expect(mounted.has(10 - ACTIVE_MOUNT_RADIUS)).toBe(true)
  })

  it('caps the mounted set near the active slide and still keeps slide 0', () => {
    const visible = new Set(Array.from({ length: 80 }, (_, index) => index))
    const mounted = computeMountedIndices(100, 50, visible)

    expect(mounted.size).toBe(MAX_MOUNTED_THUMBNAILS)
    expect(mounted.has(0)).toBe(true)
    expect(mounted.has(50)).toBe(true)
    expect(mounted.has(99)).toBe(false)
  })
})

describe('drop-target index math', () => {
  it('inserts before the first midpoint that the pointer has not crossed', () => {
    const bounds = stackedBounds(3)

    expect(computeInsertionIndex(20, 'vertical', 3, bounds)).toBe(0)
    expect(computeInsertionIndex(60, 'vertical', 3, bounds)).toBe(1)
    expect(computeInsertionIndex(300, 'vertical', 3, bounds)).toBe(3)
  })

  it('uses the horizontal axis when the strip is horizontal', () => {
    const bounds = [
      { height: 80, left: 0, top: 0, width: 100 },
      { height: 80, left: 108, top: 0, width: 100 },
    ]

    expect(computeInsertionIndex(40, 'horizontal', 2, bounds)).toBe(0)
    expect(computeInsertionIndex(140, 'horizontal', 2, bounds)).toBe(1)
    expect(computeInsertionIndex(400, 'horizontal', 2, bounds)).toBe(2)
  })

  it('adds the scroll offset to the pointer coordinate', () => {
    expect(pointerCoordinate('vertical', 10, 20, 5)).toBe(25)
    expect(pointerCoordinate('horizontal', 10, 20, 5)).toBe(15)
  })

  it('collapses an insertion index after the source into a destination index', () => {
    expect(computeDropToIndex(0, 3)).toBe(2)
    expect(computeDropToIndex(2, 0)).toBe(0)
    expect(computeDropToIndex(1, 1)).toBe(1)
    expect(computeDropToIndex(1, 2)).toBe(1)
  })

  it('derives a reorder destination from the live insertion index', () => {
    expect(computeReorderDestination(0, 3)).toBe(2)
    expect(computeReorderDestination(2, 0)).toBe(0)
    expect(computeReorderDestination(null, 1)).toBeNull()
    expect(computeReorderDestination(1, null)).toBeNull()
  })
})

describe('preview offset', () => {
  it('shifts the dragged slide and the slides it passes', () => {
    expect(computePreviewOffset(0, 0, 2, true)).toBe(2)
    expect(computePreviewOffset(1, 0, 2, true)).toBe(-1)
    expect(computePreviewOffset(2, 0, 2, true)).toBe(-1)

    expect(computePreviewOffset(2, 2, 0, true)).toBe(-2)
    expect(computePreviewOffset(0, 2, 0, true)).toBe(1)
    expect(computePreviewOffset(1, 2, 0, true)).toBe(1)
  })

  it('does not preview a same-index hover', () => {
    expect(computePreviewOffset(0, 0, 0, false)).toBe(0)
    expect(previewTranslationCss(0)).toBeNull()
  })

  it('builds the same transform CSS the strip applies during a drag', () => {
    expect(previewTranslationCss(2)).toBe('calc(200% + 1rem)')
    expect(previewTranslationCss(-1)).toBe('calc(-100% - 0.5rem)')
    expect(previewTransformStyle('vertical', 2)).toEqual({
      transform: 'translateY(calc(200% + 1rem))',
    })
    expect(previewTransformStyle('horizontal', -1)).toEqual({
      transform: 'translateX(calc(-100% - 0.5rem))',
    })
  })
})

describe('keyboard navigation helpers', () => {
  it('maps alt-arrow keys to a reorder delta for each orientation', () => {
    expect(altArrowReorderDelta('ArrowDown', 'vertical')).toBe(1)
    expect(altArrowReorderDelta('ArrowUp', 'vertical')).toBe(-1)
    expect(altArrowReorderDelta('ArrowRight', 'horizontal')).toBe(1)
    expect(altArrowReorderDelta('ArrowLeft', 'horizontal')).toBe(-1)
    expect(altArrowReorderDelta('Home', 'vertical')).toBe(0)
    expect(altArrowReorderDelta('End', 'horizontal')).toBe(0)
    expect(altArrowReorderDelta('Delete', 'vertical')).toBe(0)
  })

  it('clamps destinations to the slide range', () => {
    expect(clampSlideIndex(-1, 3)).toBe(0)
    expect(clampSlideIndex(8, 3)).toBe(2)
  })

  it('reorders on alt-arrow and ignores home/end/delete', () => {
    expect(
      resolveThumbnailKeyboardAction({
        altKey: true,
        index: 0,
        key: 'ArrowDown',
        orientation: 'vertical',
        slideCount: 3,
      }),
    ).toEqual({ fromIndex: 0, toIndex: 1, type: 'reorder' })

    expect(
      resolveThumbnailKeyboardAction({
        altKey: true,
        index: 2,
        key: 'ArrowDown',
        orientation: 'vertical',
        slideCount: 3,
      }),
    ).toEqual({ fromIndex: 2, toIndex: 2, type: 'reorder' })

    for (const key of ['Home', 'End', 'Delete', 'ArrowDown'] as const) {
      expect(
        resolveThumbnailKeyboardAction({
          altKey: false,
          index: 1,
          key,
          orientation: 'vertical',
          slideCount: 3,
        }),
      ).toEqual({ type: 'none' })
    }
  })
})
