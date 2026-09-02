import { PREVIEW_FRAME_WIDTH } from '@/lib/deck/deck-preview'

export const THUMBNAIL_STRIP_WIDTH_PX = 168
export const THUMBNAIL_MOUNT_BUFFER = 5
export const ACTIVE_MOUNT_RADIUS = 3
export const MAX_MOUNTED_THUMBNAILS = 24
export const INITIAL_EAGER_THUMBNAILS = 5
export const HORIZONTAL_THUMBNAIL_WIDTH_PX = 152

export type ThumbnailOrientation = 'horizontal' | 'vertical'

export type ThumbnailBounds = Pick<DOMRect, 'height' | 'left' | 'top' | 'width'>

export type ScheduledThumbnailFrame =
  { id: number; type: 'animation-frame' } | { id: ReturnType<typeof setTimeout>; type: 'timeout' }

export type ThumbnailKeyboardAction =
  { fromIndex: number; toIndex: number; type: 'reorder' } | { type: 'none' }

export function requestThumbnailFrame(callback: FrameRequestCallback): ScheduledThumbnailFrame {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return {
      id: globalThis.requestAnimationFrame(callback),
      type: 'animation-frame',
    }
  }

  return {
    id: setTimeout(() => {
      const now =
        typeof globalThis.performance === 'object' ? globalThis.performance.now() : Date.now()

      callback(now)
    }, 16),
    type: 'timeout',
  }
}

export function cancelThumbnailFrame(frame: ScheduledThumbnailFrame) {
  if (frame.type === 'animation-frame') {
    globalThis.cancelAnimationFrame?.(frame.id)
    return
  }

  clearTimeout(frame.id)
}

export function computeMountedIndices(
  slideCount: number,
  activeIndex: number,
  visibleIndices: Set<number>,
) {
  const indices = new Set<number>()

  let rangeMin = activeIndex
  let rangeMax = activeIndex

  if (visibleIndices.size > 0) {
    rangeMin = Math.min(...visibleIndices)
    rangeMax = Math.max(...visibleIndices)
  }

  const bufferedStart = Math.max(0, rangeMin - THUMBNAIL_MOUNT_BUFFER)
  const bufferedEnd = Math.min(slideCount - 1, rangeMax + THUMBNAIL_MOUNT_BUFFER)

  for (let index = bufferedStart; index <= bufferedEnd; index += 1) {
    indices.add(index)
  }

  for (
    let index = Math.max(0, activeIndex - ACTIVE_MOUNT_RADIUS);
    index <= Math.min(slideCount - 1, activeIndex + ACTIVE_MOUNT_RADIUS);
    index += 1
  ) {
    indices.add(index)
  }

  // Keep slide 1 materialized even after the strip scrolls elsewhere. Its
  // small eager image is requested only after the main preview is ready.
  if (slideCount > 0) {
    indices.add(0)
  }

  if (indices.size <= MAX_MOUNTED_THUMBNAILS) {
    return indices
  }

  const sorted = [...indices].sort(
    (left, right) => Math.abs(left - activeIndex) - Math.abs(right - activeIndex) || left - right,
  )

  const selected = sorted.slice(0, MAX_MOUNTED_THUMBNAILS)

  if (slideCount > 0 && !selected.includes(0)) {
    selected[selected.length - 1] = 0
  }

  return new Set(selected)
}

export function pointerCoordinate(
  orientation: ThumbnailOrientation,
  clientX: number,
  clientY: number,
  scrollOffset: number,
) {
  return (orientation === 'vertical' ? clientY : clientX) + scrollOffset
}

export function axisScrollDelta(
  orientation: ThumbnailOrientation,
  current: { left: number; top: number },
  start: { left: number; top: number },
) {
  return orientation === 'vertical' ? current.top - start.top : current.left - start.left
}

export function computeInsertionIndex(
  coordinate: number,
  orientation: ThumbnailOrientation,
  slideCount: number,
  bounds: Array<ThumbnailBounds | null>,
) {
  for (let slideIndex = 0; slideIndex < slideCount; slideIndex += 1) {
    const rect = bounds[slideIndex]
    if (!rect) continue

    const midpoint =
      orientation === 'vertical' ? rect.top + rect.height / 2 : rect.left + rect.width / 2
    if (coordinate < midpoint) return slideIndex
  }

  return slideCount
}

export function computeDropToIndex(fromIndex: number, insertionIndex: number) {
  return insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex
}

export function computeReorderDestination(
  draggedIndex: number | null,
  insertionIndex: number | null,
) {
  if (draggedIndex === null || insertionIndex === null) {
    return null
  }

  return computeDropToIndex(draggedIndex, insertionIndex)
}

export function computePreviewOffset(
  index: number,
  draggedIndex: number | null,
  reorderDestination: number | null,
  showDropPreview: boolean,
) {
  if (!showDropPreview || draggedIndex === null || reorderDestination === null) {
    return 0
  }

  if (index === draggedIndex) {
    return reorderDestination - draggedIndex
  }

  if (draggedIndex < reorderDestination && index > draggedIndex && index <= reorderDestination) {
    return -1
  }

  if (draggedIndex > reorderDestination && index >= reorderDestination && index < draggedIndex) {
    return 1
  }

  return 0
}

export function previewTranslationCss(previewOffset: number) {
  if (!previewOffset) {
    return null
  }

  const previewDistance = Math.abs(previewOffset)

  return `calc(${previewOffset < 0 ? '-' : ''}${previewDistance * 100}% ${previewOffset < 0 ? '-' : '+'} ${previewDistance * 0.5}rem)`
}

export function previewTransformStyle(
  orientation: ThumbnailOrientation,
  previewOffset: number,
): { transform: string } | undefined {
  const translation = previewTranslationCss(previewOffset)

  if (!translation) {
    return undefined
  }

  return {
    transform:
      orientation === 'vertical' ? `translateY(${translation})` : `translateX(${translation})`,
  }
}

export function thumbnailStripScale(orientation: ThumbnailOrientation) {
  return orientation === 'vertical'
    ? (THUMBNAIL_STRIP_WIDTH_PX - 16) / PREVIEW_FRAME_WIDTH
    : HORIZONTAL_THUMBNAIL_WIDTH_PX / PREVIEW_FRAME_WIDTH
}

export function altArrowReorderDelta(key: string, orientation: ThumbnailOrientation): -1 | 0 | 1 {
  if (orientation === 'vertical') {
    if (key === 'ArrowUp') return -1
    if (key === 'ArrowDown') return 1
    return 0
  }

  if (key === 'ArrowLeft') return -1
  if (key === 'ArrowRight') return 1
  return 0
}

export function clampSlideIndex(index: number, slideCount: number) {
  return Math.max(0, Math.min(slideCount - 1, index))
}

export function resolveThumbnailKeyboardAction({
  altKey,
  index,
  key,
  orientation,
  slideCount,
}: {
  altKey: boolean
  index: number
  key: string
  orientation: ThumbnailOrientation
  slideCount: number
}): ThumbnailKeyboardAction {
  if (!altKey) {
    return { type: 'none' }
  }

  const delta = altArrowReorderDelta(key, orientation)

  if (delta === 0) {
    return { type: 'none' }
  }

  return {
    fromIndex: index,
    toIndex: clampSlideIndex(index + delta, slideCount),
    type: 'reorder',
  }
}
