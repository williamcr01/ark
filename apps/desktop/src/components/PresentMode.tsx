import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeftIcon, ChevronRightIcon, ShieldAlertIcon, XIcon } from 'lucide-react'

import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { type ElementSize } from '@/lib/deck/deck-preview'
import { previewCompromiseCopy } from '@/lib/ui/preview-compromise-copy'
import type { PreviewBridgeCompromiseReason } from '@/hooks/usePreviewBridgeSession'
import { cn } from '@/lib/ui/utils'

const CONTROLS_IDLE_MS = 2500
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const PRESENT_MODE_BACKDROP = (
  <div aria-hidden className="pointer-events-auto fixed inset-0 z-[40] bg-[#000]" />
)

function PresentControlsBar({
  activeSlideIndex,
  canGoNext,
  canGoPrevious,
  controlsVisible,
  exitPresentMode,
  goToPresentSlide,
  slideCount,
}: {
  activeSlideIndex: number
  canGoNext: boolean
  canGoPrevious: boolean
  controlsVisible: boolean
  exitPresentMode: () => void
  goToPresentSlide: (index: number) => void
  slideCount: number
}) {
  return (
    <div
      className={cn(
        'pointer-events-auto absolute inset-x-0 bottom-0 flex justify-center px-4 pb-5 transition-opacity duration-300 sm:pb-7',
        controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#111]/90 px-2 py-2 shadow-2xl shadow-black/50">
        <Button
          aria-label="Previous slide"
          className="size-9 rounded-full border-white/10 bg-white/10 text-white hover:bg-white/20 disabled:text-white/40"
          disabled={!canGoPrevious}
          onClick={() => {
            goToPresentSlide(activeSlideIndex - 1)
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ChevronLeftIcon aria-hidden className="size-4" />
        </Button>

        <div
          aria-live="polite"
          className="min-w-28 select-none px-3 text-center text-xs font-medium tabular-nums tracking-[0.18em] text-white/80"
        >
          {activeSlideIndex + 1} / {slideCount}
        </div>

        <Button
          aria-label="Next slide"
          className="size-9 rounded-full border-white/10 bg-white/10 text-white hover:bg-white/20 disabled:text-white/40"
          disabled={!canGoNext}
          onClick={() => {
            goToPresentSlide(activeSlideIndex + 1)
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ChevronRightIcon aria-hidden className="size-4" />
        </Button>

        <div aria-hidden className="mx-1 h-6 w-px bg-white/10" />

        <Button
          aria-label="Exit presentation"
          className="rounded-full border-white/10 bg-white/10 px-4 text-xs font-medium text-white hover:bg-white/20"
          onClick={exitPresentMode}
          size="sm"
          type="button"
          variant="ghost"
        >
          <XIcon aria-hidden className="size-3.5" />
          <span>Exit</span>
        </Button>
      </div>
    </div>
  )
}

type PresentModeProps = {
  activeSlideIndex: number
  previewCompromised: boolean
  previewCompromiseReason?: PreviewBridgeCompromiseReason | null
  slideCount: number
  onGoToSlide: (index: number) => void
  onExit: (finalSlideIndex: number) => void
  onViewportSizeChange?: (size: ElementSize) => void
}

function readElementSize(element: HTMLElement | null): ElementSize {
  if (!element) {
    return { width: 0, height: 0 }
  }

  const { width, height } = element.getBoundingClientRect()
  return { width, height }
}

function useElementSize<T extends HTMLElement>(onSizeChange?: (size: ElementSize) => void) {
  const elementRef = useRef<T>(null)
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })
  const onSizeChangeRef = useRef(onSizeChange)

  useEffect(() => {
    onSizeChangeRef.current = onSizeChange
  }, [onSizeChange])

  useLayoutEffect(() => {
    const element = elementRef.current

    if (!element) {
      return
    }

    const updateSize = () => {
      const next = readElementSize(element)

      // Skip 0×0 first layout so overlay present keeps the window-seeded size.
      if (next.width <= 0 || next.height <= 0) {
        return
      }

      onSizeChangeRef.current?.(next)

      setSize((current) => {
        if (
          Math.abs(current.width - next.width) < 0.5 &&
          Math.abs(current.height - next.height) < 0.5
        ) {
          return current
        }

        return next
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
  activeSlideIndex,
  previewCompromised,
  previewCompromiseReason = null,
  slideCount,
  onGoToSlide,
  onExit,
  onViewportSizeChange,
}: PresentModeProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const idleTimerRef = useRef<number | null>(null)
  const currentSlideIndexRef = useRef(activeSlideIndex)
  const hasExitedRef = useRef(false)
  const hadFullscreenRef = useRef(false)
  // Viewport size is reported to the parent event-driven from the ResizeObserver
  // (the child owns that external subscription), not through an effect.
  const handleViewportSizeChange = useCallback(
    (size: ElementSize) => {
      onViewportSizeChange?.(size)
    },
    [onViewportSizeChange],
  )
  const [viewportRef] = useElementSize<HTMLDivElement>(handleViewportSizeChange)
  const setPresenterRoot = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node
      viewportRef.current = node
    },
    [viewportRef],
  )
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
    window.addEventListener('keydown', showControls)
    window.addEventListener('mousemove', showControls)
    window.addEventListener('touchstart', showControls, { passive: true })

    return () => {
      window.removeEventListener('keydown', showControls)
      window.removeEventListener('mousemove', showControls)
      window.removeEventListener('touchstart', showControls)
    }
  }, [showControls])

  useEffect(() => {
    const root = rootRef.current
    const fullscreenTarget = document.documentElement

    if (!root) {
      return
    }

    root.focus({ preventScroll: true })

    const handleFullscreenChange = () => {
      if (document.fullscreenElement === fullscreenTarget) {
        hadFullscreenRef.current = true
        return
      }

      if (hadFullscreenRef.current) {
        hadFullscreenRef.current = false
        finishExit()
      }
    }

    const requestFullscreen = async () => {
      if (!fullscreenTarget.requestFullscreen) {
        return
      }

      try {
        await fullscreenTarget.requestFullscreen()
        hadFullscreenRef.current = document.fullscreenElement === fullscreenTarget
      } catch {
        // Overlay present is the intentional desktop fallback; do not toast.
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    void requestFullscreen()

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [finishExit])

  useEffect(() => {
    const root = rootRef.current

    if (!root) {
      return
    }

    const handleTabTrap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return
      }

      const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) => !element.hasAttribute('disabled'),
      )

      if (focusable.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const focusInside = active instanceof Node && root.contains(active)

      if (event.shiftKey) {
        if (!focusInside || active === first || active === root) {
          event.preventDefault()
          last.focus()
        }
        return
      }

      if (!focusInside || active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleTabTrap, true)

    return () => {
      window.removeEventListener('keydown', handleTabTrap, true)
    }
  }, [])

  const exitPresentMode = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {
        finishExit()
      })
      return
    }

    finishExit()
  }, [finishExit])

  const goToPresentSlide = useCallback(
    (index: number) => {
      if (index < 0 || index >= slideCount) {
        return
      }

      currentSlideIndexRef.current = index
      onGoToSlide(index)
      showControls()
    },
    [onGoToSlide, showControls, slideCount],
  )

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

  const canGoPrevious = activeSlideIndex > 0
  const canGoNext = activeSlideIndex < slideCount - 1
  const compromiseCopy = previewCompromiseCopy(previewCompromiseReason)

  const presenter = (
    // react-doctor-disable-next-line react-doctor/prefer-html-dialog -- fullscreen presentation surface: manual focus management, document.fullscreenElement integration, and custom z-index stacking with the reused preview iframe; native <dialog> top-layer semantics conflict with those interactions
    <div
      aria-labelledby="ark-present-mode-title"
      aria-modal="true"
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden text-white outline-none"
      onFocus={showControls}
      onKeyDown={showControls}
      onMouseMove={showControls}
      onTouchStart={showControls}
      ref={setPresenterRoot}
      role="dialog"
      tabIndex={-1}
    >
      <h2 className="sr-only" id="ark-present-mode-title">
        Presentation mode
      </h2>

      {previewCompromised ? (
        <Alert
          className="pointer-events-auto absolute inset-x-4 top-4 z-10 border-destructive/30 text-xs shadow-sm"
          variant="destructive"
        >
          <div className="flex items-start gap-2">
            <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">{compromiseCopy.title}</p>
              <p>{compromiseCopy.body}</p>
            </div>
          </div>
        </Alert>
      ) : null}

      <PresentControlsBar
        activeSlideIndex={activeSlideIndex}
        canGoNext={canGoNext}
        canGoPrevious={canGoPrevious}
        controlsVisible={controlsVisible}
        exitPresentMode={exitPresentMode}
        goToPresentSlide={goToPresentSlide}
        slideCount={slideCount}
      />
    </div>
  )

  return (
    <>
      {createPortal(PRESENT_MODE_BACKDROP, document.body)}
      {createPortal(presenter, document.body)}
    </>
  )
}

export type { PresentModeProps }
