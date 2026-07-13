import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
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

type ScheduledThumbnailFrame =
  { id: number; type: 'animation-frame' } | { id: ReturnType<typeof setTimeout>; type: 'timeout' }

type SlideThumbnailStripProps = {
  activeIndex: number
  id?: string
  isOpen: boolean
  onSelect: (index: number) => void
  orientation: 'horizontal' | 'vertical'
  parsedDeck: ParsedDeck
  /** Sandbox-rendered PNG URLs when available; null entries fall back to srcDoc. */
  thumbnailUrls?: (string | null)[] | null
}

type LazyThumbnailProps = {
  active: boolean
  index: number
  mountContent: boolean
  onSelect: (index: number) => void
  onThumbnailImageError: (index: number, url: string) => void
  onVisibilityChange: (index: number, isVisible: boolean) => void
  orientation: 'horizontal' | 'vertical'
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

  if (indices.size <= MAX_MOUNTED_THUMBNAILS) {
    return indices
  }

  const sorted = [...indices].sort(
    (left, right) => Math.abs(left - activeIndex) - Math.abs(right - activeIndex) || left - right,
  )

  return new Set(sorted.slice(0, MAX_MOUNTED_THUMBNAILS))
}

function LazyThumbnail({
  active,
  index,
  mountContent,
  onSelect,
  onThumbnailImageError,
  onVisibilityChange,
  orientation,
  srcDoc,
  thumbnailUrl,
  trackVisibility,
}: LazyThumbnailProps) {
  const containerRef = useRef<HTMLButtonElement>(null)

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
    <button
      aria-current={active ? 'true' : undefined}
      aria-label={`Go to slide ${index + 1}`}
      className={cn(
        'group relative shrink-0 overflow-hidden rounded-sm bg-white text-left ring-1 ring-[var(--ark-stage-border)] transition-[box-shadow,transform]',
        'hover:ring-[var(--ark-titlebar-muted)]',
        active && 'z-10 scale-[1.06] ring-[3px] ring-[var(--ark-accent)]',
        orientation === 'vertical' ? 'w-full' : 'w-[152px]',
      )}
      onClick={() => onSelect(index)}
      ref={containerRef}
      type="button"
    >
      <div
        className="relative w-full overflow-hidden bg-white"
        style={{ aspectRatio: PREVIEW_FRAME_ASPECT_RATIO }}
      >
        {mountContent ? (
          thumbnailUrl ? (
            <img
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              decoding="async"
              loading="lazy"
              onError={() => onThumbnailImageError(index, thumbnailUrl)}
              src={thumbnailUrl}
              title={`Slide ${index + 1} thumbnail`}
            />
          ) : srcDoc ? (
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
              title={`Slide ${index + 1} thumbnail`}
            />
          ) : (
            <Skeleton className="absolute inset-0 rounded-none" />
          )
        ) : (
          <Skeleton className="absolute inset-0 rounded-none" />
        )}
      </div>
      <span
        className={cn(
          'absolute bottom-1 left-1 rounded px-1 py-0.5 text-[10px] font-medium leading-none',
          active ? 'bg-[var(--ark-accent)] text-white' : 'bg-black/55 text-white',
        )}
      >
        {index + 1}
      </span>
    </button>
  )
}

export function SlideThumbnailStrip({
  activeIndex,
  id,
  isOpen,
  onSelect,
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
    () => ({
      parsedDeck,
      srcDocs: new Map<number, string>(),
    }),
    [parsedDeck],
  )

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

  const getCachedThumbnailSrcDoc = useCallback(
    (index: number) => {
      const cached = thumbnailSrcDocCache.srcDocs.get(index)

      if (cached !== undefined) {
        return cached
      }

      const srcDoc = thumbnailSrcDocCache.parsedDeck.getThumbnailSrcDoc(index)
      thumbnailSrcDocCache.srcDocs.set(index, srcDoc)

      return srcDoc
    },
    [thumbnailSrcDocCache],
  )

  const getExistingThumbnailSrcDoc = useCallback(
    (index: number) => thumbnailSrcDocCache.srcDocs.get(index) ?? null,
    [thumbnailSrcDocCache],
  )

  const fallbackCandidateIndices = useMemo(() => {
    if (!isOpen) {
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
  }, [activeIndex, getUsableThumbnailUrl, isOpen, mountedIndices])

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
      (index) => index !== activeIndex && !thumbnailSrcDocCache.srcDocs.has(index),
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
    isOpen,
    thumbnailSrcDocCache,
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
        'flex min-h-0 shrink-0 flex-col border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)]',
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
        >
          {Array.from({ length: slideCount }, (_, index) => {
            const mountContent = mountedIndices.has(index)
            const thumbnailUrl = getUsableThumbnailUrl(index)
            const needsFallback = isOpen && mountContent && !thumbnailUrl
            const srcDoc = needsFallback
              ? index === activeIndex
                ? getCachedThumbnailSrcDoc(index)
                : getExistingThumbnailSrcDoc(index)
              : null

            return (
              <div key={index} ref={index === activeIndex ? activeItemRef : undefined}>
                <LazyThumbnail
                  active={index === activeIndex}
                  index={index}
                  mountContent={mountContent}
                  onSelect={onSelect}
                  onThumbnailImageError={handleThumbnailImageError}
                  onVisibilityChange={handleVisibilityChange}
                  orientation={orientation}
                  srcDoc={srcDoc}
                  thumbnailUrl={thumbnailUrl}
                  trackVisibility={isOpen}
                />
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </aside>
  )
}
