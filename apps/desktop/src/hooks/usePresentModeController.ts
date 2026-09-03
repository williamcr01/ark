import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { type ElementSize } from '@/lib/deck/deck-preview'

import { usePresentModeIdleControls } from './usePresentModeIdleControls.ts'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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

function usePresentModeFullscreen(
  rootRef: { current: HTMLDivElement | null },
  finishExit: () => void,
) {
  const hadFullscreenRef = useRef(false)

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
  }, [finishExit, rootRef])
}

function usePresentModeTabTrap(rootRef: { current: HTMLDivElement | null }) {
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
  }, [rootRef])
}

export function usePresentModeController({
  activeSlideIndex,
  onExit,
  onGoToSlide,
  onViewportSizeChange,
  slideCount,
}: {
  activeSlideIndex: number
  onExit: (finalSlideIndex: number) => void
  onGoToSlide: (index: number) => void
  onViewportSizeChange?: (size: ElementSize) => void
  slideCount: number
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const currentSlideIndexRef = useRef(activeSlideIndex)
  const hasExitedRef = useRef(false)
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
  const { clearIdleTimer, controlsVisible, showControls } = usePresentModeIdleControls()

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

  usePresentModeFullscreen(rootRef, finishExit)
  usePresentModeTabTrap(rootRef)

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

  return {
    controlsVisible,
    exitPresentMode,
    goToPresentSlide,
    setPresenterRoot,
    showControls,
  }
}
