import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react'
import { MessageSquarePlusIcon } from 'lucide-react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  getThumbnailSandbox,
  PREVIEW_FRAME_ASPECT_RATIO,
  PREVIEW_FRAME_HEIGHT,
  PREVIEW_FRAME_WIDTH,
} from '@/lib/deck-preview'
import type { ParsedDeck } from '@/lib/deck-slides'
import { cn } from '@/lib/utils'

const THUMBNAIL_STRIP_WIDTH_PX = 168
const THUMBNAIL_MOUNT_BUFFER = 5
const ACTIVE_MOUNT_RADIUS = 3
const MAX_MOUNTED_THUMBNAILS = 24
const INITIAL_EAGER_THUMBNAILS = 5

type ScheduledThumbnailFrame =
  { id: number; type: 'animation-frame' } | { id: ReturnType<typeof setTimeout>; type: 'timeout' }

type SlideThumbnailStripProps = {
  activeIndex: number
  /** Defers thumbnail parsing and requests until the main preview is ready. */
  contentEnabled?: boolean
  /** Zero-based slide indexes currently attached as chat context. */
  contextSlideIndexes?: number[]
  id?: string
  isOpen: boolean
  onReorder?: (fromIndex: number, toIndex: number) => void | Promise<unknown>
  onSelect: (index: number) => void
  /** Toggle a slide as chat context without changing the active slide. */
  onToggleContextSlide?: (index: number) => void
  orientation: 'horizontal' | 'vertical'
  parsedDeck: ParsedDeck
  /** Sandbox-rendered PNG URLs when available; null entries fall back to srcDoc. */
  thumbnailUrls?: (string | null)[] | null
}

type ThumbnailSrcDocCacheEntry = {
  identity: string
  srcDoc: string
}

type LazyThumbnailProps = {
  active: boolean
  contextAttached: boolean
  index: number
  mountContent: boolean
  onSelect: (index: number) => void
  onReorderByKeyboard?: (index: number, event: KeyboardEvent<HTMLButtonElement>) => void
  onThumbnailImageError: (index: number, url: string) => void
  onToggleContextSlide?: (index: number) => void
  onVisibilityChange: (index: number, isVisible: boolean) => void
  orientation: 'horizontal' | 'vertical'
  prioritizeLoad: boolean
  srcDoc: string | null
  thumbnailUrl: string | null
  trackVisibility: boolean
}

function requestThumbnailFrame(callback: FrameRequestCallback): ScheduledThumbnailFrame {
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

function cancelThumbnailFrame(frame: ScheduledThumbnailFrame) {
  if (frame.type === 'animation-frame') {
    globalThis.cancelAnimationFrame?.(frame.id)
    return
  }

  clearTimeout(frame.id)
}

function computeMountedIndices(
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

const LazyThumbnail = memo(function LazyThumbnail({
  active,
  contextAttached,
  index,
  mountContent,
  onSelect,
  onReorderByKeyboard,
  onThumbnailImageError,
  onToggleContextSlide,
  onVisibilityChange,
  orientation,
  prioritizeLoad,
  srcDoc,
  thumbnailUrl,
  trackVisibility,
}: LazyThumbnailProps) {
  const containerRef = useRef<HTMLButtonElement>(null)
  const [readyThumbnailUrl, setReadyThumbnailUrl] = useState<string | null>(null)
  const imageReady = thumbnailUrl !== null && readyThumbnailUrl === thumbnailUrl

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    const markReady = () => setReadyThumbnailUrl(thumbnailUrl)

    if (typeof image.decode !== 'function') {
      markReady()
      return
    }

    void image
      .decode()
      .catch(() => undefined)
      .then(markReady)
  }

  useEffect(() => {
    if (!trackVisibility) {
      return
    }

    const element = containerRef.current

    if (!element) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        onVisibilityChange(index, entry.isIntersecting)
      },
      { threshold: 0 },
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [index, onVisibilityChange, trackVisibility])

  return (
    <div className="group/thumb relative">
      <button
        aria-current={active ? 'true' : undefined}
        aria-keyshortcuts={
          onReorderByKeyboard
            ? orientation === 'vertical'
              ? 'Alt+ArrowUp Alt+ArrowDown'
              : 'Alt+ArrowLeft Alt+ArrowRight'
            : undefined
        }
        aria-label={`Go to slide ${index + 1}`}
        className={cn(
          'relative shrink-0 overflow-hidden rounded-sm bg-white text-left ring-1 ring-[var(--ark-stage-border)]',
          'hover:ring-[var(--ark-titlebar-muted)]',
          active &&
            'z-10 ring-2 ring-[var(--ark-selection)] shadow-[inset_3px_0_var(--ark-selection)]',
          orientation === 'vertical' ? 'w-full' : 'w-[152px]',
        )}
        onClick={() => onSelect(index)}
        onKeyDown={(event) => onReorderByKeyboard?.(index, event)}
        ref={containerRef}
        type="button"
      >
        <div
          className="relative w-full overflow-hidden bg-white"
          style={{ aspectRatio: PREVIEW_FRAME_ASPECT_RATIO }}
        >
          {mountContent ? (
            <>
              {!imageReady ? (
                srcDoc ? (
                  <iframe
                    className="pointer-events-none absolute left-0 top-0 block border-0 bg-white"
                    sandbox={getThumbnailSandbox()}
                    srcDoc={srcDoc}
                    style={{
                      width: PREVIEW_FRAME_WIDTH,
                      height: PREVIEW_FRAME_HEIGHT,
                      transform: 'scale(var(--ark-thumb-scale))',
                      transformOrigin: 'top left',
                    }}
                    tabIndex={-1}
                    title={
                      thumbnailUrl ? `Loading slide ${index + 1}` : `Slide ${index + 1} thumbnail`
                    }
                  />
                ) : (
                  <Skeleton className="absolute inset-0 rounded-none" />
                )
              ) : null}
              {thumbnailUrl ? (
                <img
                  alt=""
                  className={cn(
                    'pointer-events-none absolute inset-0 h-full w-full object-cover',
                    imageReady ? 'opacity-100' : 'opacity-0',
                  )}
                  decoding="async"
                  fetchPriority={prioritizeLoad ? 'high' : 'auto'}
                  loading="eager"
                  onError={() => onThumbnailImageError(index, thumbnailUrl)}
                  onLoad={handleImageLoad}
                  src={thumbnailUrl}
                  title={`Slide ${index + 1} thumbnail`}
                />
              ) : null}
            </>
          ) : (
            <Skeleton className="absolute inset-0 rounded-none" />
          )}
        </div>
        <span
          className={cn(
            'absolute bottom-1 left-1 rounded px-1 py-0.5 text-[10px] font-medium leading-none',
            active
              ? 'bg-[var(--ark-selection)] text-primary-foreground'
              : 'bg-[var(--ark-overlay)] text-primary-foreground',
          )}
        >
          {index + 1}
        </span>
      </button>

      {onToggleContextSlide ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={
                contextAttached
                  ? `Remove slide ${index + 1} from chat`
                  : `Add slide ${index + 1} to chat`
              }
              aria-pressed={contextAttached}
              className={cn(
                'absolute right-1 top-1 z-20 flex size-6 items-center justify-center rounded-sm',
                'border border-[var(--ark-stage-border)] bg-[var(--ark-panel)]/95 text-[var(--ark-titlebar-fg)]',
                'opacity-0 shadow-sm transition-opacity',
                'focus-visible:opacity-100 group-hover/thumb:opacity-100 group-focus-within/thumb:opacity-100',
                contextAttached &&
                  'border-[var(--ark-accent)]/50 bg-[var(--ark-accent)] text-primary-foreground opacity-100',
              )}
              onClick={(event) => {
                event.stopPropagation()
                onToggleContextSlide(index)
              }}
              type="button"
            >
              <MessageSquarePlusIcon aria-hidden className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {contextAttached ? 'Remove slide from chat' : 'Add slide to chat'}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
})

function useThumbnailReorder({
  activeIndex,
  activeItemRef,
  onReorder,
  orientation,
  parsedDeck,
  slideCount,
}: {
  activeIndex: number
  activeItemRef: RefObject<HTMLDivElement | null>
  onReorder?: SlideThumbnailStripProps['onReorder']
  orientation: SlideThumbnailStripProps['orientation']
  parsedDeck: ParsedDeck
  slideCount: number
}) {
  const thumbnailRefs = useRef<(HTMLDivElement | null)[]>([])
  const thumbnailBoundsRef = useRef<(DOMRect | null)[]>([])
  const dragScrollRef = useRef<{ element: HTMLElement; left: number; top: number } | null>(null)
  const dragDeckRef = useRef<ParsedDeck | null>(null)
  const reorderPendingRef = useRef(false)
  const draggedIndexRef = useRef<number | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [insertionIndex, setInsertionIndex] = useState<number | null>(null)
  const [isReordering, setIsReordering] = useState(false)

  const commitReorder = useCallback(
    async (fromIndex: number, toIndex: number, focusDestination = false) => {
      if (!onReorder || reorderPendingRef.current || fromIndex === toIndex) return

      reorderPendingRef.current = true
      setIsReordering(true)

      try {
        await onReorder(fromIndex, toIndex)
        if (focusDestination) {
          thumbnailRefs.current[toIndex]
            ?.querySelector<HTMLButtonElement>('button[aria-label^="Go to slide"]')
            ?.focus()
        }
      } catch {
        // The persistence owner reports the error; the strip only resets interaction state.
      } finally {
        reorderPendingRef.current = false
        setIsReordering(false)
      }
    },
    [onReorder],
  )

  const handleKeyboardReorder = useCallback(
    (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
      if (!event.altKey || !onReorder) return

      const direction =
        orientation === 'vertical'
          ? event.key === 'ArrowUp'
            ? -1
            : event.key === 'ArrowDown'
              ? 1
              : 0
          : event.key === 'ArrowLeft'
            ? -1
            : event.key === 'ArrowRight'
              ? 1
              : 0

      if (direction === 0) return

      event.preventDefault()
      const destination = Math.max(0, Math.min(slideCount - 1, index + direction))
      void commitReorder(index, destination, true)
    },
    [commitReorder, onReorder, orientation, slideCount],
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

  // Insertion point is derived purely from the pointer position against bounds
  // captured at drag start. The preview translates thumbnails under the cursor,
  // so the event's target element must not participate in hit detection —
  // otherwise the computed index oscillates as thumbnails shift.
  const getInsertionIndex = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const dragScroll = dragScrollRef.current
      const scrollOffset = dragScroll
        ? orientation === 'vertical'
          ? dragScroll.element.scrollTop - dragScroll.top
          : dragScroll.element.scrollLeft - dragScroll.left
        : 0
      const coordinate = (orientation === 'vertical' ? event.clientY : event.clientX) + scrollOffset

      for (let slideIndex = 0; slideIndex < slideCount; slideIndex += 1) {
        const bounds = thumbnailBoundsRef.current[slideIndex]
        if (!bounds) continue

        const midpoint =
          orientation === 'vertical'
            ? bounds.top + bounds.height / 2
            : bounds.left + bounds.width / 2
        if (coordinate < midpoint) return slideIndex
      }

      return slideCount
    },
    [orientation, slideCount],
  )

  const handleZoneDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (draggedIndexRef.current === null || isReordering) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setInsertionIndex(getInsertionIndex(event))
    },
    [getInsertionIndex, isReordering],
  )

  const handleZoneDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const fromIndex = draggedIndexRef.current
      if (fromIndex === null) return

      event.preventDefault()
      const insertion = getInsertionIndex(event)
      const toIndex = insertion > fromIndex ? insertion - 1 : insertion

      draggedIndexRef.current = null
      if (toIndex === fromIndex) {
        clearDragState()
        return
      }

      void commitReorder(fromIndex, toIndex).finally(clearDragState)
    },
    [clearDragState, commitReorder, getInsertionIndex],
  )

  const getDragProps = useCallback(
    (index: number) => ({
      draggable: Boolean(onReorder) && !isReordering,
      onDragEnd: () => {
        if (!reorderPendingRef.current) clearDragState()
      },
      onDragStart: (event: DragEvent<HTMLDivElement>) => {
        const scrollViewport = event.currentTarget.closest<HTMLElement>(
          '[data-slot="scroll-area-viewport"]',
        )
        dragScrollRef.current = scrollViewport
          ? {
              element: scrollViewport,
              left: scrollViewport.scrollLeft,
              top: scrollViewport.scrollTop,
            }
          : null
        thumbnailBoundsRef.current = thumbnailRefs.current.map(
          (thumbnail) => thumbnail?.getBoundingClientRect() ?? null,
        )
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

  const dropZoneProps = {
    onDragOver: handleZoneDragOver,
    onDrop: handleZoneDrop,
  }

  return {
    draggedIndex,
    dropZoneProps,
    getDragProps,
    handleKeyboardReorder,
    insertionIndex,
    isReordering,
  }
}

export function SlideThumbnailStrip({
  activeIndex,
  contentEnabled = true,
  contextSlideIndexes = [],
  id,
  isOpen,
  onReorder,
  onSelect,
  onToggleContextSlide,
  orientation,
  parsedDeck,
  thumbnailUrls = null,
}: SlideThumbnailStripProps) {
  const activeItemRef = useRef<HTMLDivElement>(null)
  const { slideCount } = parsedDeck
  const [visibleIndices, setVisibleIndices] = useState<Set<number>>(() => new Set([0]))
  const [collapsedMountedIndices, setCollapsedMountedIndices] = useState<Set<number> | null>(null)
  const [failedThumbnailUrls, setFailedThumbnailUrls] = useState<ReadonlyMap<number, string>>(
    () => new Map(),
  )
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)
  const [, setThumbnailSrcDocVersion] = useState(0)
  const thumbnailSrcDocCache = useMemo(
    () => ({ entries: new Map<number, ThumbnailSrcDocCacheEntry>() }),
    [],
  )
  const {
    draggedIndex,
    dropZoneProps,
    getDragProps,
    handleKeyboardReorder,
    insertionIndex,
    isReordering,
  } = useThumbnailReorder({
    activeIndex,
    activeItemRef,
    onReorder,
    orientation,
    parsedDeck,
    slideCount,
  })
  const reorderDestination =
    draggedIndex !== null && insertionIndex !== null
      ? insertionIndex > draggedIndex
        ? insertionIndex - 1
        : insertionIndex
      : null
  const showDropPreview =
    reorderDestination !== null && draggedIndex !== null && reorderDestination !== draggedIndex

  const computedMountedIndices = useMemo(
    () => computeMountedIndices(slideCount, activeIndex, visibleIndices),
    [activeIndex, slideCount, visibleIndices],
  )

  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen)

    if (!isOpen) {
      setCollapsedMountedIndices(new Set(computedMountedIndices))
    } else {
      setCollapsedMountedIndices(null)
    }
  }

  const mountedIndices =
    isOpen || !collapsedMountedIndices ? computedMountedIndices : collapsedMountedIndices

  const getUsableThumbnailUrl = useCallback(
    (index: number) => {
      const thumbnailUrl = thumbnailUrls?.[index] ?? null

      if (!thumbnailUrl || failedThumbnailUrls.get(index) === thumbnailUrl) {
        return null
      }

      return thumbnailUrl
    },
    [failedThumbnailUrls, thumbnailUrls],
  )

  const getThumbnailSrcDocIdentity = useCallback(
    (index: number) =>
      `${parsedDeck.thumbnailSharedKey}\0${index}\0${parsedDeck.slides[index]?.outerHTML ?? ''}`,
    [parsedDeck],
  )

  const getCachedThumbnailSrcDoc = useCallback(
    (index: number) => {
      const identity = getThumbnailSrcDocIdentity(index)
      const cached = thumbnailSrcDocCache.entries.get(index)

      if (cached?.identity === identity) {
        return cached.srcDoc
      }

      const srcDoc = parsedDeck.getThumbnailSrcDoc(index)
      thumbnailSrcDocCache.entries.set(index, { identity, srcDoc })

      return srcDoc
    },
    [getThumbnailSrcDocIdentity, parsedDeck, thumbnailSrcDocCache],
  )

  const getExistingThumbnailSrcDoc = useCallback(
    (index: number) => {
      const cached = thumbnailSrcDocCache.entries.get(index)
      return cached?.identity === getThumbnailSrcDocIdentity(index) ? cached.srcDoc : null
    },
    [getThumbnailSrcDocIdentity, thumbnailSrcDocCache],
  )

  const fallbackCandidateIndices = useMemo(() => {
    if (!contentEnabled || !isOpen) {
      return []
    }

    return [...mountedIndices]
      .filter((index) => !getUsableThumbnailUrl(index))
      .sort(
        (left, right) =>
          Number(right === activeIndex) - Number(left === activeIndex) ||
          Math.abs(left - activeIndex) - Math.abs(right - activeIndex) ||
          left - right,
      )
  }, [activeIndex, contentEnabled, getUsableThumbnailUrl, isOpen, mountedIndices])

  const handleVisibilityChange = useCallback((index: number, isVisible: boolean) => {
    setVisibleIndices((current) => {
      const hasIndex = current.has(index)

      if (isVisible === hasIndex) {
        return current
      }

      const next = new Set(current)

      if (isVisible) {
        next.add(index)
      } else {
        next.delete(index)
      }

      return next
    })
  }, [])

  const handleThumbnailImageError = useCallback(
    (index: number, url: string) => {
      if (isOpen && mountedIndices.has(index)) {
        getCachedThumbnailSrcDoc(index)
      }

      setFailedThumbnailUrls((current) => {
        if (current.get(index) === url) {
          return current
        }

        const next = new Map(current)
        next.set(index, url)

        return next
      })
      setThumbnailSrcDocVersion((version) => version + 1)
    },
    [getCachedThumbnailSrcDoc, isOpen, mountedIndices],
  )

  useEffect(() => {
    if (!isOpen) {
      return
    }

    activeItemRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: orientation === 'vertical' ? 'nearest' : 'center',
      inline: orientation === 'horizontal' ? 'center' : 'nearest',
    })
  }, [activeIndex, isOpen, orientation])

  useEffect(() => {
    if (!isOpen || fallbackCandidateIndices.length === 0) {
      return
    }

    let cancelled = false
    let scheduledFrame: ScheduledThumbnailFrame | null = null
    const pendingIndices = fallbackCandidateIndices.filter(
      (index) => index !== activeIndex && !getExistingThumbnailSrcDoc(index),
    )

    const buildNext = () => {
      if (cancelled) {
        return
      }

      const index = pendingIndices.shift()

      if (index === undefined) {
        return
      }

      getCachedThumbnailSrcDoc(index)
      setThumbnailSrcDocVersion((version) => version + 1)

      if (pendingIndices.length > 0) {
        scheduledFrame = requestThumbnailFrame(buildNext)
      }
    }

    if (pendingIndices.length > 0) {
      scheduledFrame = requestThumbnailFrame(buildNext)
    }

    return () => {
      cancelled = true

      if (scheduledFrame) {
        cancelThumbnailFrame(scheduledFrame)
      }
    }
  }, [
    activeIndex,
    fallbackCandidateIndices,
    getCachedThumbnailSrcDoc,
    getExistingThumbnailSrcDoc,
    isOpen,
  ])

  if (slideCount === 0) {
    return null
  }

  const thumbScale =
    orientation === 'vertical'
      ? (THUMBNAIL_STRIP_WIDTH_PX - 16) / PREVIEW_FRAME_WIDTH
      : 152 / PREVIEW_FRAME_WIDTH

  return (
    <aside
      aria-hidden={!isOpen}
      className={cn(
        'flex min-h-0 shrink-0 flex-col border-[var(--ark-line)] bg-[var(--ark-panel)]',
        orientation === 'vertical' ? 'w-[168px] border-r' : 'h-[132px] border-b',
        !isOpen && 'hidden',
      )}
      id={id}
      style={{ '--ark-thumb-scale': thumbScale } as CSSProperties}
    >
      <div className="flex h-9 shrink-0 items-center border-b border-[var(--ark-titlebar-border)] px-3">
        <span className="text-xs font-medium text-[var(--ark-titlebar-fg)]">Slides</span>
        <span className="ml-auto text-[11px] text-[var(--ark-titlebar-muted)]">{slideCount}</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div
          className={cn('p-2', orientation === 'vertical' ? 'flex flex-col gap-2' : 'flex gap-2')}
          data-slot="slide-reorder-zone"
          {...dropZoneProps}
        >
          {Array.from({ length: slideCount }, (_, index) => {
            const mountContent = contentEnabled && mountedIndices.has(index)
            const thumbnailUrl = getUsableThumbnailUrl(index)
            const srcDoc =
              isOpen && mountContent
                ? !thumbnailUrl && index === activeIndex
                  ? getCachedThumbnailSrcDoc(index)
                  : getExistingThumbnailSrcDoc(index)
                : null
            const previewOffset =
              !showDropPreview || draggedIndex === null || reorderDestination === null
                ? 0
                : index === draggedIndex
                  ? reorderDestination - draggedIndex
                  : draggedIndex < reorderDestination &&
                      index > draggedIndex &&
                      index <= reorderDestination
                    ? -1
                    : draggedIndex > reorderDestination &&
                        index >= reorderDestination &&
                        index < draggedIndex
                      ? 1
                      : 0
            const previewDistance = Math.abs(previewOffset)
            const previewTranslation = previewOffset
              ? `calc(${previewOffset < 0 ? '-' : ''}${previewDistance * 100}% ${previewOffset < 0 ? '-' : '+'} ${previewDistance * 0.5}rem)`
              : null

            return (
              <div
                className={cn(
                  'relative rounded-sm',
                  onReorder && !isReordering && 'cursor-grab active:cursor-grabbing',
                  draggedIndex !== null && 'transition-transform duration-100 ease-out',
                  draggedIndex === index && 'z-20 opacity-70',
                )}
                {...getDragProps(index)}
                key={index}
                style={
                  previewTranslation
                    ? {
                        transform:
                          orientation === 'vertical'
                            ? `translateY(${previewTranslation})`
                            : `translateX(${previewTranslation})`,
                      }
                    : undefined
                }
              >
                <LazyThumbnail
                  active={index === activeIndex}
                  contextAttached={contextSlideIndexes.includes(index)}
                  index={index}
                  mountContent={mountContent}
                  onSelect={onSelect}
                  onReorderByKeyboard={onReorder ? handleKeyboardReorder : undefined}
                  onThumbnailImageError={handleThumbnailImageError}
                  onToggleContextSlide={onToggleContextSlide}
                  onVisibilityChange={handleVisibilityChange}
                  orientation={orientation}
                  prioritizeLoad={index < INITIAL_EAGER_THUMBNAILS || index === activeIndex}
                  srcDoc={srcDoc}
                  thumbnailUrl={thumbnailUrl}
                  trackVisibility={isOpen && draggedIndex === null}
                />
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </aside>
  )
}
