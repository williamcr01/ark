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
  onVisibilityChange: (index: number, isVisible: boolean) => void
  orientation: 'horizontal' | 'vertical'
  srcDoc: string
  thumbnailUrl: string | null
  trackVisibility: boolean
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
  onVisibilityChange,
  orientation,
  srcDoc,
  thumbnailUrl,
  trackVisibility,
}: LazyThumbnailProps) {
  const containerRef = useRef<HTMLButtonElement>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const useImage = Boolean(thumbnailUrl) && !imageFailed

  useEffect(() => {
    setImageFailed(false)
  }, [thumbnailUrl])

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
        'group relative shrink-0 overflow-hidden rounded-sm bg-white text-left ring-1 ring-[var(--ark-stage-border)] transition-shadow',
        'hover:ring-[var(--ark-titlebar-muted)]',
        active && 'ring-2 ring-[var(--ark-accent)]',
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
          useImage && thumbnailUrl ? (
            <img
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              decoding="async"
              loading="lazy"
              onError={() => setImageFailed(true)}
              src={thumbnailUrl}
              title={`Slide ${index + 1} thumbnail`}
            />
          ) : (
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
  const { slideCount, thumbnailSrcDocs } = parsedDeck
  const [visibleIndices, setVisibleIndices] = useState<Set<number>>(() => new Set([0]))
  const [collapsedMountedIndices, setCollapsedMountedIndices] = useState<Set<number> | null>(null)
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)

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
          {thumbnailSrcDocs.map((srcDoc, index) => (
            <div key={index} ref={index === activeIndex ? activeItemRef : undefined}>
              <LazyThumbnail
                active={index === activeIndex}
                index={index}
                mountContent={mountedIndices.has(index)}
                onSelect={onSelect}
                onVisibilityChange={handleVisibilityChange}
                orientation={orientation}
                srcDoc={srcDoc}
                thumbnailUrl={thumbnailUrls?.[index] ?? null}
                trackVisibility={isOpen}
              />
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}
