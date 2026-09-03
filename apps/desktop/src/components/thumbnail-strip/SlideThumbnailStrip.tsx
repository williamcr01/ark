import { useRef, type CSSProperties, type ReactNode } from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useStripScrollSync } from '@/hooks/useStripScrollSync'
import {
  useThumbnailDragReorder,
  type ThumbnailDropZoneProps,
} from '@/hooks/useThumbnailDragReorder'
import { useThumbnailKeyboardNav } from '@/hooks/useThumbnailKeyboardNav'
import { useThumbnailMounting } from '@/hooks/useThumbnailMounting'
import { useThumbnailSrcDocs } from '@/hooks/useThumbnailSrcDocs'
import type { ParsedDeck } from '@/lib/deck/deck-slides'
import {
  computeReorderDestination,
  thumbnailStripScale,
  type ThumbnailOrientation,
} from '@/lib/deck/thumbnail-strip'
import { cn } from '@/lib/ui/utils'

import { ThumbnailStripItem } from './ThumbnailStripItem'
import { ThumbnailStripSkeletons } from './ThumbnailStripSkeletons'

const EMPTY_CONTEXT_SLIDE_INDEXES: number[] = []

type SlideThumbnailStripProps = {
  activeIndex: number
  /** Defers thumbnail parsing and requests until the main preview is ready. */
  contentEnabled?: boolean
  /** Zero-based slide indexes currently attached as chat context. */
  contextSlideIndexes?: number[]
  id?: string
  isLoading?: boolean
  isOpen: boolean
  onReorder?: (fromIndex: number, toIndex: number) => void | Promise<unknown>
  onSelect: (index: number) => void
  /** Toggle a slide as chat context without changing the active slide. */
  onToggleContextSlide?: (index: number) => void
  orientation: ThumbnailOrientation
  parsedDeck: ParsedDeck
  /** Sandbox-rendered PNG URLs when available; null entries fall back to srcDoc. */
  thumbnailUrls?: (string | null)[] | null
}

function ThumbnailStripFrame({
  children,
  dropZoneProps,
  id,
  isLoading,
  isOpen,
  orientation,
  slideCount,
  thumbScale,
}: {
  children: ReactNode
  dropZoneProps: ThumbnailDropZoneProps
  id?: string
  isLoading: boolean
  isOpen: boolean
  orientation: ThumbnailOrientation
  slideCount: number
  thumbScale: number
}) {
  return (
    <aside
      aria-hidden={!isOpen}
      aria-label={isLoading ? 'Loading slide thumbnails' : undefined}
      aria-busy={isLoading || undefined}
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
        {isLoading ? (
          <Skeleton className="ml-auto h-3 w-4 rounded-sm motion-reduce:animate-none" />
        ) : (
          <span className="ml-auto text-[11px] text-[var(--ark-titlebar-muted)]">{slideCount}</span>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div
          className={cn('p-2', orientation === 'vertical' ? 'flex flex-col gap-2' : 'flex gap-2')}
          data-slot="slide-reorder-zone"
          {...dropZoneProps}
        >
          {children}
        </div>
      </ScrollArea>
    </aside>
  )
}

export function SlideThumbnailStrip({
  activeIndex,
  contentEnabled = true,
  contextSlideIndexes = EMPTY_CONTEXT_SLIDE_INDEXES,
  id,
  isLoading = false,
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
  const { handleVisibilityChange, mountedIndices } = useThumbnailMounting({
    activeIndex,
    isOpen,
    slideCount,
  })
  const srcDocs = useThumbnailSrcDocs({
    activeIndex,
    contentEnabled,
    isOpen,
    mountedIndices,
    parsedDeck,
    thumbnailUrls,
  })
  const drag = useThumbnailDragReorder({
    activeIndex,
    activeItemRef,
    onReorder,
    orientation,
    parsedDeck,
    slideCount,
  })
  const { handleKeyboardReorder } = useThumbnailKeyboardNav({
    commitReorder: drag.commitReorder,
    onReorder,
    orientation,
    slideCount,
  })

  useStripScrollSync({ activeIndex, activeItemRef, isOpen, orientation })

  const reorderDestination = computeReorderDestination(drag.draggedIndex, drag.insertionIndex)
  const showDropPreview =
    reorderDestination !== null &&
    drag.draggedIndex !== null &&
    reorderDestination !== drag.draggedIndex

  if (slideCount === 0 && !isLoading) {
    return null
  }

  return (
    <ThumbnailStripFrame
      dropZoneProps={drag.dropZoneProps}
      id={id}
      isLoading={isLoading}
      isOpen={isOpen}
      orientation={orientation}
      slideCount={slideCount}
      thumbScale={thumbnailStripScale(orientation)}
    >
      {isLoading ? (
        <ThumbnailStripSkeletons orientation={orientation} />
      ) : (
        Array.from({ length: slideCount }, (_, index) => (
          <ThumbnailStripItem
            activeIndex={activeIndex}
            contentEnabled={contentEnabled}
            contextSlideIndexes={contextSlideIndexes}
            draggedIndex={drag.draggedIndex}
            getCachedThumbnailSrcDoc={srcDocs.getCachedThumbnailSrcDoc}
            getDragProps={drag.getDragProps}
            getExistingThumbnailSrcDoc={srcDocs.getExistingThumbnailSrcDoc}
            getUsableThumbnailUrl={srcDocs.getUsableThumbnailUrl}
            handleKeyboardReorder={handleKeyboardReorder}
            handleThumbnailImageError={srcDocs.handleThumbnailImageError}
            handleVisibilityChange={handleVisibilityChange}
            index={index}
            isOpen={isOpen}
            isReordering={drag.isReordering}
            key={index}
            mountedIndices={mountedIndices}
            onReorder={onReorder}
            onSelect={onSelect}
            onToggleContextSlide={onToggleContextSlide}
            orientation={orientation}
            reorderDestination={reorderDestination}
            showDropPreview={showDropPreview}
          />
        ))
      )}
    </ThumbnailStripFrame>
  )
}
