import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'

import type { DeckPreviewHandle } from '@/lib/deck/deck-preview-handle'

export function useDeckPreviewPresent(args: {
  presentHandleRef?: RefObject<DeckPreviewHandle | null>
  goToSlide: (index: number) => void
  activeSlideIndexRef: { current: number }
  isPresentOpen: boolean
  setIsPresentOpen: Dispatch<SetStateAction<boolean>>
}) {
  const { presentHandleRef, goToSlide, activeSlideIndexRef, isPresentOpen, setIsPresentOpen } = args
  const [presentViewportSize, setPresentViewportSize] = useState(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }))
  const pendingPresentExitIndexRef = useRef<number | null>(null)

  const handlePresentViewportSizeChange = useCallback((size: { width: number; height: number }) => {
    if (size.width <= 0 || size.height <= 0) {
      return
    }

    setPresentViewportSize((current) => {
      if (
        Math.abs(current.width - size.width) < 0.5 &&
        Math.abs(current.height - size.height) < 0.5
      ) {
        return current
      }

      return size
    })
  }, [])

  const openPresentMode = useCallback(() => {
    setPresentViewportSize({
      width: window.innerWidth,
      height: window.innerHeight,
    })
    setIsPresentOpen(true)
  }, [setIsPresentOpen])

  useEffect(() => {
    if (isPresentOpen || pendingPresentExitIndexRef.current === null) {
      return
    }

    const finalIndex = pendingPresentExitIndexRef.current
    pendingPresentExitIndexRef.current = null
    goToSlide(finalIndex)
  }, [goToSlide, isPresentOpen])

  useEffect(() => {
    if (!presentHandleRef) {
      return
    }

    presentHandleRef.current = {
      openPresent: openPresentMode,
      getActiveSlideIndex: () => activeSlideIndexRef.current,
    }
    return () => {
      presentHandleRef.current = null
    }
  }, [activeSlideIndexRef, openPresentMode, presentHandleRef])

  return {
    handlePresentViewportSizeChange,
    openPresentMode,
    pendingPresentExitIndexRef,
    presentViewportSize,
  }
}
