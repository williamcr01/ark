import { createPortal } from 'react-dom'
import { ChevronLeftIcon, ChevronRightIcon, ShieldAlertIcon, XIcon } from 'lucide-react'

import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { type ElementSize } from '@/lib/deck/deck-preview'
import { previewCompromiseCopy } from '@/lib/ui/preview-compromise-copy'
import type { PreviewBridgeCompromiseReason } from '@/hooks/usePreviewBridgeSession'
import { usePresentModeController } from '@/hooks/usePresentModeController'
import { cn } from '@/lib/ui/utils'

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

export function PresentMode({
  activeSlideIndex,
  previewCompromised,
  previewCompromiseReason = null,
  slideCount,
  onGoToSlide,
  onExit,
  onViewportSizeChange,
}: PresentModeProps) {
  const { controlsVisible, exitPresentMode, goToPresentSlide, setPresenterRoot, showControls } =
    usePresentModeController({
      activeSlideIndex,
      onExit,
      onGoToSlide,
      onViewportSizeChange,
      slideCount,
    })

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
