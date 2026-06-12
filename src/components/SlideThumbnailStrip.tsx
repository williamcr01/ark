import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  PREVIEW_FRAME_ASPECT_RATIO,
  PREVIEW_FRAME_HEIGHT,
  PREVIEW_FRAME_WIDTH,
} from '@/lib/deck-preview'
import type { ParsedDeck } from '@/lib/deck-slides'
import { cn } from '@/lib/utils'

const THUMBNAIL_STRIP_WIDTH_PX = 168
const MAX_MOUNTED_THUMBNAILS = 12
const NEAR_VIEWPORT_ROOT_MARGIN = '120px'

type SlideThumbnailStripProps = {
  activeIndex: number
  id?: string
  onSelect: (index: number) => void
  orientation: 'horizontal' | 'vertical'
  parsedDeck: ParsedDeck
}

type LazyThumbnailProps = {
  active: boolean
  index: number
  onSelect: (index: number) => void
  orientation: 'horizontal' | 'vertical'
  shouldMount: boolean
  srcDoc: string
}

function LazyThumbnail({
  active,
  index,
  onSelect,
  orientation,
  shouldMount,
  srcDoc,
}: LazyThumbnailProps) {
  const containerRef = useRef<HTMLButtonElement>(null)
  const [isNearViewport, setIsNearViewport] = useState(false)

  useEffect(() => {
    const element = containerRef.current

    if (!element) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsNearViewport(entry.isIntersecting)
      },
      { rootMargin: NEAR_VIEWPORT_ROOT_MARGIN },
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [])

  const mountIframe = shouldMount && isNearViewport

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
        {mountIframe ? (
          <iframe
            className="pointer-events-none absolute left-0 top-0 block border-0 bg-white"
            sandbox=""
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
        )}
      </div>
      <span
        className={cn(
          'absolute bottom-1 left-1 rounded px-1 py-0.5 text-[10px] font-medium leading-none',
          active
            ? 'bg-[var(--ark-accent)] text-white'
            : 'bg-black/55 text-white',
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
  onSelect,
  orientation,
  parsedDeck,
}: SlideThumbnailStripProps) {
  const activeItemRef = useRef<HTMLDivElement>(null)
  const { slideCount, thumbnailSrcDocs } = parsedDeck

  const mountedIndices = new Set<number>()

  for (
    let index = Math.max(0, activeIndex - 3);
    index <= Math.min(slideCount - 1, activeIndex + 3);
    index += 1
  ) {
    mountedIndices.add(index)
  }

  let mountedCount = mountedIndices.size

  for (let index = 0; index < slideCount && mountedCount < MAX_MOUNTED_THUMBNAILS; index += 1) {
    if (!mountedIndices.has(index)) {
      mountedIndices.add(index)
      mountedCount += 1
    }
  }

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: orientation === 'vertical' ? 'nearest' : 'center',
      inline: orientation === 'horizontal' ? 'center' : 'nearest',
    })
  }, [activeIndex, orientation])

  if (slideCount === 0) {
    return null
  }

  const thumbScale =
    orientation === 'vertical'
      ? (THUMBNAIL_STRIP_WIDTH_PX - 16) / PREVIEW_FRAME_WIDTH
      : 152 / PREVIEW_FRAME_WIDTH

  return (
    <aside
      className={cn(
        'flex min-h-0 shrink-0 flex-col border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)]',
        orientation === 'vertical'
          ? 'w-[168px] border-r'
          : 'h-[132px] border-b',
      )}
      id={id}
      style={{ '--ark-thumb-scale': thumbScale } as CSSProperties}
    >
      <div className="flex h-9 shrink-0 items-center border-b border-[var(--ark-titlebar-border)] px-3">
        <span className="text-xs font-medium text-[var(--ark-titlebar-fg)]">
          Slides
        </span>
        <span className="ml-auto text-[11px] text-[var(--ark-titlebar-muted)]">
          {slideCount}
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div
          className={cn(
            'p-2',
            orientation === 'vertical' ? 'flex flex-col gap-2' : 'flex gap-2',
          )}
        >
          {thumbnailSrcDocs.map((srcDoc, index) => (
            <div
              key={index}
              ref={index === activeIndex ? activeItemRef : undefined}
            >
              <LazyThumbnail
                active={index === activeIndex}
                index={index}
                onSelect={onSelect}
                orientation={orientation}
                shouldMount={mountedIndices.has(index)}
                srcDoc={srcDoc}
              />
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}
