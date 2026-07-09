import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeftIcon, ChevronRightIcon, ShieldAlertIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useDeckPreviewFrame } from '@/hooks/useDeckPreviewFrame'
import { useDeckSlideNavigation } from '@/hooks/useDeckSlideNavigation'
import { usePreviewBridgeSession } from '@/hooks/usePreviewBridgeSession'
import {
  getPreviewFrameScale,
  getPreviewFrameStyle,
  getPreviewSandbox,
  getPreviewStageStyle,
  type ElementSize,
  type DeckRuntimeMode,
} from '@/lib/deck-preview'
import { reportRuntimeError } from '@/lib/runtime-error-api'
import { cn } from '@/lib/utils'

const CONTROLS_IDLE_MS = 2500

type PresentModeProps = {
  html: string
  slideCount: number
  runtimeMode: DeckRuntimeMode
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
        if (Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5) {
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
  runtimeMode,
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

  const previewFrame = useDeckPreviewFrame(html, slideCount > 0)
  const reportedNavigationErrorRef = useRef(false)
  const reportNavigationCompromise = useCallback(() => {
    if (reportedNavigationErrorRef.current) {
      return
    }

    reportedNavigationErrorRef.current = true

    void reportRuntimeError({
      slideIndex: currentSlideIndexRef.current,
      runtimeMode,
      severity: 'error',
      message:
        'Preview stopped: the deck attempted an unexpected navigation away from the sandbox render URL.',
      source: 'preview-navigation-guard',
    }).catch(() => {
      reportedNavigationErrorRef.current = false
    })
  }, [runtimeMode])
  const bridgeSession = usePreviewBridgeSession(previewFrame.iframeKey, {
    enabled: slideCount > 0 && Boolean(previewFrame.handshake?.trim()),
    handshake: previewFrame.handshake,
    sandboxOrigin: previewFrame.sandboxOrigin,
    onCompromised: reportNavigationCompromise,
  })
  const previewCompromised = bridgeSession.compromised

  useEffect(() => {
    reportedNavigationErrorRef.current = false
  }, [previewFrame.iframeKey])

  const { activeSlideIndex, goToSlide } = useDeckSlideNavigation(
    iframeRef,
    slideCount,
    html,
    slideCount > 0 && !previewCompromised,
    {
      runtimeMode,
      initialSlideIndex,
      keyboardMode: previewCompromised ? 'off' : 'present',
      sandboxOrigin: previewFrame.sandboxOrigin,
      syncOnLoad: false,
      canPostToFrame: bridgeSession.canPostToFrame,
      shouldAcceptInbound: bridgeSession.shouldAcceptInbound,
      onSlideChange: (index) => {
        currentSlideIndexRef.current = index
        showControls()
      },
    },
  )

  useEffect(() => {
    if (!bridgeSession.armed || previewCompromised) {
      return
    }

    goToSlide(currentSlideIndexRef.current)
  }, [bridgeSession.armed, goToSlide, previewCompromised, previewFrame.iframeKey])

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
      aria-labelledby="ark-present-mode-title"
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
      <h2 className="sr-only" id="ark-present-mode-title">
        Presentation mode
      </h2>

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
          {previewCompromised || (!previewFrame.iframeSrc && !previewFrame.iframeSrcDoc) ? null : (
            <iframe
              className="absolute left-0 top-0 block border-0 bg-white"
              key={previewFrame.iframeKey}
              onLoad={() => {
                const decision = bridgeSession.onFrameLoad()

                if (!decision.allowDownstream) {
                  return
                }

                goToSlide(currentSlideIndexRef.current)
              }}
              ref={iframeRef}
              referrerPolicy="no-referrer"
              sandbox={getPreviewSandbox(runtimeMode)}
              src={previewFrame.iframeSrc}
              srcDoc={previewFrame.iframeSrcDoc}
              style={previewFrameStyle}
              tabIndex={-1}
              title="Ark presentation mode"
            />
          )}
          {previewCompromised ? (
            <div className="absolute inset-x-4 top-4 z-10 rounded-lg border border-red-500/30 bg-red-50/95 px-3 py-2 text-xs text-red-900 shadow-sm backdrop-blur">
              <div className="flex items-start gap-2">
                <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">Preview stopped</p>
                  <p>
                    The deck attempted an unexpected navigation. Presentation preview was torn down
                    to stop further bridge messages from reaching an untrusted page.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
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
              showControls()
              goToSlide(activeSlideIndex + 1)
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
    </div>
  )

  return createPortal(presenter, document.body)
}

export type { PresentModeProps }
