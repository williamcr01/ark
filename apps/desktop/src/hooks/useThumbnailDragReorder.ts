import { useCallback, useRef, useState, type DragEvent, type RefObject } from 'react'

import type { ParsedDeck } from '@/lib/deck/deck-slides'
import {
  axisScrollDelta,
  computeDropToIndex,
  computeInsertionIndex,
  pointerCoordinate,
  type ThumbnailOrientation,
} from '@/lib/deck/thumbnail-strip'

type UseThumbnailDragReorderArgs = {
  activeIndex: number
  activeItemRef: RefObject<HTMLDivElement | null>
  onReorder?: (fromIndex: number, toIndex: number) => void | Promise<unknown>
  orientation: ThumbnailOrientation
  parsedDeck: ParsedDeck
  slideCount: number
}

export type ThumbnailDropZoneProps = {
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
}

export type ThumbnailDragProps = {
  draggable: boolean
  onDragEnd: () => void
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  ref: (node: HTMLDivElement | null) => void
}

type DragScrollSnapshot = { element: HTMLElement; left: number; top: number }

function focusThumbnailAt(thumbnails: Array<HTMLDivElement | null>, index: number) {
  thumbnails[index]?.querySelector<HTMLButtonElement>('button[aria-label^="Go to slide"]')?.focus()
}

async function runThumbnailReorder(options: {
  focusDestination: boolean
  fromIndex: number
  onReorder: (fromIndex: number, toIndex: number) => void | Promise<unknown>
  pendingRef: { current: boolean }
  setIsReordering: (value: boolean) => void
  thumbnails: Array<HTMLDivElement | null>
  toIndex: number
}) {
  const {
    focusDestination,
    fromIndex,
    onReorder,
    pendingRef,
    setIsReordering,
    thumbnails,
    toIndex,
  } = options

  if (pendingRef.current || fromIndex === toIndex) return

  pendingRef.current = true
  setIsReordering(true)

  try {
    await onReorder(fromIndex, toIndex)
    if (focusDestination) {
      focusThumbnailAt(thumbnails, toIndex)
    }
  } catch {
    // The persistence owner reports the error; the strip only resets interaction state.
  } finally {
    pendingRef.current = false
    setIsReordering(false)
  }
}

function insertionIndexFromDragEvent(
  event: DragEvent<HTMLDivElement>,
  orientation: ThumbnailOrientation,
  slideCount: number,
  bounds: Array<DOMRect | null>,
  dragScroll: DragScrollSnapshot | null,
) {
  const scrollOffset = dragScroll
    ? axisScrollDelta(
        orientation,
        { left: dragScroll.element.scrollLeft, top: dragScroll.element.scrollTop },
        { left: dragScroll.left, top: dragScroll.top },
      )
    : 0

  return computeInsertionIndex(
    pointerCoordinate(orientation, event.clientX, event.clientY, scrollOffset),
    orientation,
    slideCount,
    bounds,
  )
}

function snapshotDragStart(
  event: DragEvent<HTMLDivElement>,
  thumbnailRefs: Array<HTMLDivElement | null>,
) {
  const scrollViewport = event.currentTarget.closest<HTMLElement>(
    '[data-slot="scroll-area-viewport"]',
  )

  return {
    bounds: thumbnailRefs.map((thumbnail) => thumbnail?.getBoundingClientRect() ?? null),
    dragScroll: scrollViewport
      ? {
          element: scrollViewport,
          left: scrollViewport.scrollLeft,
          top: scrollViewport.scrollTop,
        }
      : null,
  }
}

export function useThumbnailDragReorder({
  activeIndex,
  activeItemRef,
  onReorder,
  orientation,
  parsedDeck,
  slideCount,
}: UseThumbnailDragReorderArgs) {
  const thumbnailRefs = useRef<(HTMLDivElement | null)[]>([])
  const thumbnailBoundsRef = useRef<(DOMRect | null)[]>([])
  const dragScrollRef = useRef<DragScrollSnapshot | null>(null)
  const dragDeckRef = useRef<ParsedDeck | null>(null)
  const reorderPendingRef = useRef(false)
  const draggedIndexRef = useRef<number | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [insertionIndex, setInsertionIndex] = useState<number | null>(null)
  const [isReordering, setIsReordering] = useState(false)

  const commitReorder = useCallback(
    async (fromIndex: number, toIndex: number, focusDestination = false) => {
      if (!onReorder) return
      await runThumbnailReorder({
        focusDestination,
        fromIndex,
        onReorder,
        pendingRef: reorderPendingRef,
        setIsReordering,
        thumbnails: thumbnailRefs.current,
        toIndex,
      })
    },
    [onReorder],
  )

  const clearDragState = useCallback(() => {
    draggedIndexRef.current = null
    thumbnailBoundsRef.current = []
    dragScrollRef.current = null
    dragDeckRef.current = null
    setDraggedIndex(null)
    setInsertionIndex(null)
  }, [])

  // The reordered deck HTML propagates before the reorder promise resolves.
  // Index-based preview transforms applied on top of the already-reordered deck
  // would visually re-shuffle it, so drop the preview as soon as the strip
  // renders a deck other than the one this drag started on.
  if (draggedIndex !== null && dragDeckRef.current !== parsedDeck) {
    clearDragState()
  }

  const handleZoneDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (draggedIndexRef.current === null || isReordering) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setInsertionIndex(
        insertionIndexFromDragEvent(
          event,
          orientation,
          slideCount,
          thumbnailBoundsRef.current,
          dragScrollRef.current,
        ),
      )
    },
    [isReordering, orientation, slideCount],
  )

  const handleZoneDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const fromIndex = draggedIndexRef.current
      if (fromIndex === null) return

      event.preventDefault()
      const toIndex = computeDropToIndex(
        fromIndex,
        insertionIndexFromDragEvent(
          event,
          orientation,
          slideCount,
          thumbnailBoundsRef.current,
          dragScrollRef.current,
        ),
      )

      draggedIndexRef.current = null
      if (toIndex === fromIndex) {
        clearDragState()
        return
      }

      void commitReorder(fromIndex, toIndex).finally(clearDragState)
    },
    [clearDragState, commitReorder, orientation, slideCount],
  )

  const getDragProps = useCallback(
    (index: number): ThumbnailDragProps => ({
      draggable: Boolean(onReorder) && !isReordering,
      onDragEnd: () => {
        if (!reorderPendingRef.current) clearDragState()
      },
      onDragStart: (event: DragEvent<HTMLDivElement>) => {
        const snapshot = snapshotDragStart(event, thumbnailRefs.current)
        dragScrollRef.current = snapshot.dragScroll
        thumbnailBoundsRef.current = snapshot.bounds
        dragDeckRef.current = parsedDeck
        draggedIndexRef.current = index
        setDraggedIndex(index)
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', String(index))
      },
      ref: (node: HTMLDivElement | null) => {
        thumbnailRefs.current[index] = node
        if (index === activeIndex) activeItemRef.current = node
      },
    }),
    [activeIndex, activeItemRef, clearDragState, isReordering, onReorder, parsedDeck],
  )

  return {
    commitReorder,
    draggedIndex,
    dropZoneProps: {
      onDragOver: handleZoneDragOver,
      onDrop: handleZoneDrop,
    },
    getDragProps,
    insertionIndex,
    isReordering,
  }
}
