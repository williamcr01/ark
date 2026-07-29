import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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

function LazyThumbnail({
  active,
  contextAttached,
  index,
  mountContent,
  onSelect,
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
        aria-label={`Go to slide ${index + 1}`}
        className={cn(
          'relative shrink-0 overflow-hidden rounded-sm bg-white text-left ring-1 ring-[var(--ark-stage-border)]',
          'hover:ring-[var(--ark-titlebar-muted)]',
          active &&
            'z-10 ring-2 ring-[var(--ark-selection)] shadow-[inset_3px_0_var(--ark-selection)]',
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
}

export function SlideThumbnailStrip({
  activeIndex,
  contentEnabled = true,
  contextSlideIndexes = [],
  id,
  isOpen,
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

            return (
              <div key={index} ref={index === activeIndex ? activeItemRef : undefined}>
                <LazyThumbnail
                  active={index === activeIndex}
                  contextAttached={contextSlideIndexes.includes(index)}
                  index={index}
                  mountContent={mountContent}
                  onSelect={onSelect}
                  onThumbnailImageError={handleThumbnailImageError}
                  onToggleContextSlide={onToggleContextSlide}
                  onVisibilityChange={handleVisibilityChange}
                  orientation={orientation}
                  prioritizeLoad={index < INITIAL_EAGER_THUMBNAILS || index === activeIndex}
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
