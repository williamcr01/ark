import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useDeckSlideNavigation } from '@/hooks/useDeckSlideNavigation'
import {
  getPreviewFrameScale,
  getPreviewFrameStyle,
  getPreviewHtml,
  getPreviewStageStyle,
  type ElementSize,
  type PreviewMode,
} from '@/lib/deck-preview'
import { cn } from '@/lib/utils'

const CONTROLS_IDLE_MS = 2500

type PresentModeProps = {
  html: string
  slideCount: number
  previewMode: PreviewMode
  initialSlideIndex: number
  onExit: (finalSlideIndex: number) => void
}

function useElementSize<T extends HTMLElement>() {
  const elementRef = useRef<T>(null)
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })

  useEffect(() => {
    const element = elementRef.current

    if (!element) {
      return
    }

    const updateSize = () => {
      const { width, height } = element.getBoundingClientRect()

      setSize((current) => {
        if (
          Math.abs(current.width - width) < 0.5 &&
          Math.abs(current.height - height) < 0.5
        ) {
          return current
        }

        return { width, height }
      })
    }

    updateSize()

    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(element)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  return [elementRef, size] as const
}

export function PresentMode({
  html,
  slideCount,
  previewMode,
  initialSlideIndex,
  onExit,
}: PresentModeProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const idleTimerRef = useRef<number | null>(null)
  const currentSlideIndexRef = useRef(initialSlideIndex)
  const hasExitedRef = useRef(false)
  const hadFullscreenRef = useRef(false)
  const [viewportRef, viewportSize] = useElementSize<HTMLDivElement>()
  const [controlsVisible, setControlsVisible] = useState(true)

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current === null) {
      return
    }

    window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = null
  }, [])

  const scheduleControlsHide = useCallback(() => {
    clearIdleTimer()

    idleTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false)
      idleTimerRef.current = null
    }, CONTROLS_IDLE_MS)
  }, [clearIdleTimer])

  const showControls = useCallback(() => {
    setControlsVisible(true)
    scheduleControlsHide()
  }, [scheduleControlsHide])

  const finishExit = useCallback(() => {
    if (hasExitedRef.current) {
      return
    }

    hasExitedRef.current = true
    clearIdleTimer()
    onExit(currentSlideIndexRef.current)
  }, [clearIdleTimer, onExit])

  const { activeSlideIndex, goToSlide } = useDeckSlideNavigation(
    iframeRef,
    slideCount,
    html,
    slideCount > 0,
    {
      previewMode,
      initialSlideIndex,
      keyboardMode: 'present',
      syncOnLoad: true,
      onSlideChange: (index) => {
        currentSlideIndexRef.current = index
        showControls()
      },
    },
  )

  useEffect(() => {
    currentSlideIndexRef.current = activeSlideIndex
  }, [activeSlideIndex])

  useEffect(() => {
    scheduleControlsHide()

    return () => {
      clearIdleTimer()
    }
  }, [clearIdleTimer, scheduleControlsHide])

  useEffect(() => {
    const root = rootRef.current

    if (!root) {
      return
    }

    root.focus({ preventScroll: true })

    const handleFullscreenChange = () => {
      if (document.fullscreenElement === root) {
        hadFullscreenRef.current = true
        return
      }

      if (hadFullscreenRef.current) {
        hadFullscreenRef.current = false
        finishExit()
      }
    }

    const requestFullscreen = async () => {
      if (!root.requestFullscreen) {
        toast.info('Fullscreen unavailable — using window overlay')
        return
      }

      try {
        await root.requestFullscreen()
        hadFullscreenRef.current = document.fullscreenElement === root
      } catch {
        if (!hasExitedRef.current) {
          toast.info('Fullscreen unavailable — using window overlay')
        }
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    void requestFullscreen()

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [finishExit])

  const exitPresentMode = useCallback(() => {
    const root = rootRef.current

    if (document.fullscreenElement === root) {
      void document.exitFullscreen().catch(() => {
        finishExit()
      })
      return
    }

    finishExit()
  }, [finishExit])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      exitPresentMode()
    }

    window.addEventListener('keydown', handleEscape, true)

    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [exitPresentMode])

  const previewFrameScale = getPreviewFrameScale(viewportSize)
  const previewStageStyle = getPreviewStageStyle(previewFrameScale)
  const previewFrameStyle = getPreviewFrameStyle(previewFrameScale)
  const canGoPrevious = activeSlideIndex > 0
  const canGoNext = activeSlideIndex < slideCount - 1

  const presenter = (
    <div
      aria-label="Presentation mode"
      aria-modal="true"
      className="fixed inset-0 z-50 overflow-hidden bg-black text-white outline-none"
      onFocus={showControls}
      onKeyDown={showControls}
      onMouseMove={showControls}
      onTouchStart={showControls}
      ref={rootRef}
      role="dialog"
      tabIndex={-1}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.08),_transparent_45%),linear-gradient(180deg,_rgba(255,255,255,0.05),_transparent_22%,_rgba(255,255,255,0.04))]"
      />

      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        ref={viewportRef}
      >
        <div
          className="relative max-h-full max-w-full overflow-hidden bg-white shadow-[0_40px_120px_rgba(0,0,0,0.65)] ring-1 ring-white/10"
          style={previewStageStyle}
        >
          <iframe
            className="absolute left-0 top-0 block border-0 bg-white"
            ref={iframeRef}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts"
            srcDoc={getPreviewHtml(html)}
            style={previewFrameStyle}
            tabIndex={-1}
            title="Ark presentation mode"
          />
        </div>
      </div>

      <div
        className={cn(
          'absolute inset-x-0 bottom-0 flex justify-center px-4 pb-5 transition-opacity duration-300 sm:pb-7',
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/80 px-2 py-2 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <Button
            aria-label="Previous slide"
            className="size-9 rounded-full border-white/10 bg-white/10 text-white hover:bg-white/20 disabled:text-white/40"
            disabled={!canGoPrevious}
            onClick={() => {
              showControls()
              goToSlide(activeSlideIndex - 1)
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronLeftIcon className="size-4" />
          </Button>

          <div className="min-w-28 select-none px-3 text-center text-xs font-medium tabular-nums tracking-[0.18em] text-white/80">
            {activeSlideIndex + 1} / {slideCount}
          </div>

          <Button
            aria-label="Next slide"
            className="size-9 rounded-full border-white/10 bg-white/10 text-white hover:bg-white/20 disabled:text-white/40"
            disabled={!canGoNext}
            onClick={() => {
              showControls()
              goToSlide(activeSlideIndex + 1)
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronRightIcon className="size-4" />
          </Button>

          <div className="mx-1 h-6 w-px bg-white/10" />

          <Button
            className="rounded-full border-white/10 bg-white/10 px-4 text-xs font-medium text-white hover:bg-white/20"
            onClick={exitPresentMode}
            size="sm"
            type="button"
            variant="ghost"
          >
            <XIcon className="size-3.5" />
            Exit
          </Button>
        </div>
      </div>
    </div>
  )

  return createPortal(presenter, document.body)
}

export type { PresentModeProps }
