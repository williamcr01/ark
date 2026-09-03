import type { KeyboardEvent } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import type { ThumbnailDragProps } from '@/hooks/useThumbnailDragReorder'
import { PREVIEW_FRAME_ASPECT_RATIO } from '@/lib/deck/deck-preview'
import {
  computePreviewOffset,
  INITIAL_EAGER_THUMBNAILS,
  previewTransformStyle,
  type ThumbnailOrientation,
} from '@/lib/deck/thumbnail-strip'
import { cn } from '@/lib/ui/utils'

import { SlideThumbnail } from './SlideThumbnail'

type ThumbnailStripItemArgs = {
  activeIndex: number
  contentEnabled: boolean
  contextSlideIndexes: number[]
  draggedIndex: number | null
  getCachedThumbnailSrcDoc: (index: number) => string | null
  getDragProps: (index: number) => ThumbnailDragProps
  getExistingThumbnailSrcDoc: (index: number) => string | null
  getUsableThumbnailUrl: (index: number) => string | null
  handleKeyboardReorder: (index: number, event: KeyboardEvent<HTMLButtonElement>) => void
  handleThumbnailImageError: (index: number, url: string) => void
  handleVisibilityChange: (index: number, isVisible: boolean) => void
  index: number
  isOpen: boolean
  isReordering: boolean
  mountedIndices: Set<number>
  onReorder?: (fromIndex: number, toIndex: number) => void | Promise<unknown>
  onSelect: (index: number) => void
  onToggleContextSlide?: (index: number) => void
  orientation: ThumbnailOrientation
  reorderDestination: number | null
  showDropPreview: boolean
}

export function ThumbnailStripSkeletons({ orientation }: { orientation: ThumbnailOrientation }) {
  return Array.from({ length: INITIAL_EAGER_THUMBNAILS }, (_, index) => (
    <div className="relative rounded-sm" key={index}>
      <Skeleton
        className={cn(
          'block shrink-0 rounded-sm motion-reduce:animate-none',
          orientation === 'vertical' ? 'w-full' : 'w-[152px]',
        )}
        style={{ aspectRatio: PREVIEW_FRAME_ASPECT_RATIO }}
      />
    </div>
  ))
}

export function ThumbnailStripItem({
  activeIndex,
  contentEnabled,
  contextSlideIndexes,
  draggedIndex,
  getCachedThumbnailSrcDoc,
  getDragProps,
  getExistingThumbnailSrcDoc,
  getUsableThumbnailUrl,
  handleKeyboardReorder,
  handleThumbnailImageError,
  handleVisibilityChange,
  index,
  isOpen,
  isReordering,
  mountedIndices,
  onReorder,
  onSelect,
  onToggleContextSlide,
  orientation,
  reorderDestination,
  showDropPreview,
}: ThumbnailStripItemArgs) {
  const mountContent = contentEnabled && mountedIndices.has(index)
  const thumbnailUrl = getUsableThumbnailUrl(index)
  const srcDoc =
    isOpen && mountContent
      ? !thumbnailUrl && index === activeIndex
        ? getCachedThumbnailSrcDoc(index)
        : getExistingThumbnailSrcDoc(index)
      : null
  const previewOffset = computePreviewOffset(
    index,
    draggedIndex,
    reorderDestination,
    showDropPreview,
  )

  return (
    <div
      className={cn(
        'relative rounded-sm',
        onReorder && !isReordering && 'cursor-grab active:cursor-grabbing',
        draggedIndex !== null && 'transition-transform duration-100 ease-out',
        draggedIndex === index && 'z-20 opacity-70',
      )}
      {...getDragProps(index)}
      style={previewTransformStyle(orientation, previewOffset)}
    >
      <SlideThumbnail
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
}
