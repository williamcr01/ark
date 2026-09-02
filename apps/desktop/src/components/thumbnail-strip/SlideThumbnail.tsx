import { memo, useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import { MessageSquarePlusIcon } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  getThumbnailSandbox,
  PREVIEW_FRAME_ASPECT_RATIO,
  PREVIEW_FRAME_HEIGHT,
  PREVIEW_FRAME_WIDTH,
} from '@/lib/deck/deck-preview'
import type { ThumbnailOrientation } from '@/lib/deck/thumbnail-strip'
import { cn } from '@/lib/ui/utils'

type SlideThumbnailProps = {
  active: boolean
  contextAttached: boolean
  index: number
  mountContent: boolean
  onSelect: (index: number) => void
  onReorderByKeyboard?: (index: number, event: KeyboardEvent<HTMLButtonElement>) => void
  onThumbnailImageError: (index: number, url: string) => void
  onToggleContextSlide?: (index: number) => void
  orientation: ThumbnailOrientation
  prioritizeLoad: boolean
  srcDoc: string | null
  thumbnailUrl: string | null
  trackVisibility: boolean
  onVisibilityChange: (index: number, isVisible: boolean) => void
}

function ThumbnailMedia({
  imageReady,
  index,
  mountContent,
  onImageLoad,
  onThumbnailImageError,
  prioritizeLoad,
  srcDoc,
  thumbnailUrl,
}: {
  imageReady: boolean
  index: number
  mountContent: boolean
  onImageLoad: (event: SyntheticEvent<HTMLImageElement>) => void
  onThumbnailImageError: (index: number, url: string) => void
  prioritizeLoad: boolean
  srcDoc: string | null
  thumbnailUrl: string | null
}) {
  return (
    <>
      <div
        className="relative w-full overflow-hidden bg-white"
        style={{ aspectRatio: PREVIEW_FRAME_ASPECT_RATIO }}
      >
        {mountContent ? (
          <>
            {!imageReady && !srcDoc ? <Skeleton className="absolute inset-0 rounded-none" /> : null}
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
                onLoad={onImageLoad}
                src={thumbnailUrl}
                title={`Slide ${index + 1} thumbnail`}
              />
            ) : null}
          </>
        ) : (
          <Skeleton className="absolute inset-0 rounded-none" />
        )}
      </div>
      {mountContent && !imageReady && srcDoc ? (
        <iframe
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 z-0 block rounded-sm border-0 bg-white"
          sandbox={getThumbnailSandbox()}
          srcDoc={srcDoc}
          style={{
            width: PREVIEW_FRAME_WIDTH,
            height: PREVIEW_FRAME_HEIGHT,
            transform: 'scale(var(--ark-thumb-scale))',
            transformOrigin: 'top left',
          }}
          tabIndex={-1}
          title={thumbnailUrl ? `Loading slide ${index + 1}` : `Slide ${index + 1} thumbnail`}
        />
      ) : null}
    </>
  )
}

function ThumbnailContextToggle({
  contextAttached,
  index,
  onToggleContextSlide,
}: {
  contextAttached: boolean
  index: number
  onToggleContextSlide: (index: number) => void
}) {
  return (
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
              'border-[var(--ark-fill-border)] bg-[var(--ark-fill)] text-[var(--ark-fill-fg)] opacity-100',
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
  )
}

export const SlideThumbnail = memo(function SlideThumbnail({
  active,
  contextAttached,
  index,
  mountContent,
  onSelect,
  onReorderByKeyboard,
  onThumbnailImageError,
  onToggleContextSlide,
  orientation,
  prioritizeLoad,
  srcDoc,
  thumbnailUrl,
  trackVisibility,
  onVisibilityChange,
}: SlideThumbnailProps) {
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
        <ThumbnailMedia
          imageReady={imageReady}
          index={index}
          mountContent={mountContent}
          onImageLoad={handleImageLoad}
          onThumbnailImageError={onThumbnailImageError}
          prioritizeLoad={prioritizeLoad}
          srcDoc={srcDoc}
          thumbnailUrl={thumbnailUrl}
        />
        <span
          className={cn(
            'absolute bottom-1 left-1 z-10 rounded px-1 py-0.5 text-[10px] font-medium leading-none',
            active
              ? 'bg-[var(--ark-selection)] text-primary-foreground'
              : 'bg-[var(--ark-overlay)] text-primary-foreground',
          )}
        >
          {index + 1}
        </span>
      </button>

      {onToggleContextSlide ? (
        <ThumbnailContextToggle
          contextAttached={contextAttached}
          index={index}
          onToggleContextSlide={onToggleContextSlide}
        />
      ) : null}
    </div>
  )
})
