import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import {
  createDeckGotoMessage,
  isDeckBridgeMessageFromRuntime,
  isDeckReadyMessage,
  isDeckRuntimeErrorMessage,
  isDeckSlideChangeMessage,
  type DeckMetadata,
} from '../../shared/deck-bridge.ts'
import type { DeckRuntimeMode } from '@/lib/deck-runtime'

const PREVIEW_NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
const PRESENT_NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', ' ', 'Spacebar', 'Enter', 'PageDown'])
const PRESENT_PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp'])

type DeckNavKeyboardMode = 'preview' | 'present' | 'off'

export type DeckNavOptions = {
  runtimeMode?: DeckRuntimeMode
  initialSlideIndex?: number
  keyboardMode?: DeckNavKeyboardMode
  onSlideChange?: (index: number) => void
  onDeckReady?: (payload: { index: number; slideCount: number; metadata: DeckMetadata }) => void
  onRuntimeError?: (message: string, source?: string) => void
  syncOnLoad?: boolean
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  const tag = target.tagName

  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true
  }

  return Boolean(target.closest('[contenteditable="true"], [role="textbox"]'))
}

function isActivatableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(target.closest('button, a[href], [role="button"]'))
}

function clampSlideIndex(index: number, slideCount: number) {
  if (!Number.isFinite(index) || slideCount <= 0) {
    return 0
  }

  return Math.max(0, Math.min(slideCount - 1, Math.floor(index)))
}

function getPreviewKeyboardTargetIndex(key: string, currentIndex: number, slideCount: number) {
  if (!PREVIEW_NAV_KEYS.has(key)) {
    return null
  }

  const delta = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1

  return clampSlideIndex(currentIndex + delta, slideCount)
}

function getPresentKeyboardTargetIndex(key: string, currentIndex: number, slideCount: number) {
  if (PRESENT_NEXT_KEYS.has(key)) {
    return clampSlideIndex(currentIndex + 1, slideCount)
  }

  if (PRESENT_PREV_KEYS.has(key)) {
    return clampSlideIndex(currentIndex - 1, slideCount)
  }

  if (key === 'Home') {
    return 0
  }

  if (key === 'End') {
    return clampSlideIndex(slideCount - 1, slideCount)
  }

  return null
}

export function useDeckSlideNavigation(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  slideCount: number,
  html: string,
  enabled: boolean,
  options: DeckNavOptions = {},
) {
  const {
    initialSlideIndex = 0,
    keyboardMode = 'preview',
    onSlideChange,
    onDeckReady,
    onRuntimeError,
    syncOnLoad = true,
  } = options
  const [activeSlideIndex, setActiveSlideIndex] = useState(() =>
    clampSlideIndex(initialSlideIndex, slideCount),
  )
  const prevHtmlRef = useRef(html)
  const activeSlideIndexRef = useRef(activeSlideIndex)

  const commitSlideIndex = useCallback(
    (index: number) => {
      const clampedIndex = clampSlideIndex(index, slideCount)

      if (activeSlideIndexRef.current === clampedIndex) {
        setActiveSlideIndex(clampedIndex)
        return
      }

      activeSlideIndexRef.current = clampedIndex
      setActiveSlideIndex(clampedIndex)
      onSlideChange?.(clampedIndex)
    },
    [onSlideChange, slideCount],
  )

  useEffect(() => {
    activeSlideIndexRef.current = activeSlideIndex
  }, [activeSlideIndex])

  useEffect(() => {
    if (prevHtmlRef.current === html) {
      return
    }

    prevHtmlRef.current = html
    commitSlideIndex(initialSlideIndex)
  }, [commitSlideIndex, html, initialSlideIndex])

  const goToSlide = useCallback(
    (index: number) => {
      if (index < 0 || index >= slideCount) {
        return
      }

      const clampedIndex = clampSlideIndex(index, slideCount)

      commitSlideIndex(clampedIndex)

      const iframeWindow = iframeRef.current?.contentWindow

      if (!iframeWindow) {
        return
      }

      iframeWindow.postMessage(createDeckGotoMessage(clampedIndex), '*')
    },
    [commitSlideIndex, iframeRef, slideCount],
  )

  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleMessage = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow

      if (!iframeWindow || event.source !== iframeWindow) {
        return
      }

      const data = event.data

      if (!isDeckBridgeMessageFromRuntime(data)) {
        return
      }

      if (isDeckReadyMessage(data)) {
        onDeckReady?.({
          index: data.index,
          slideCount: data.slideCount,
          metadata: data.metadata,
        })
        commitSlideIndex(data.index)
        return
      }

      if (isDeckRuntimeErrorMessage(data)) {
        onRuntimeError?.(data.message, data.source)
        return
      }

      if (isDeckSlideChangeMessage(data)) {
        commitSlideIndex(data.index)
      }
    }

    window.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [commitSlideIndex, enabled, iframeRef, onDeckReady, onRuntimeError])

  useEffect(() => {
    if (!enabled || slideCount === 0 || keyboardMode === 'off') {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return
      }

      if (keyboardMode === 'present' && isActivatableTarget(event.target)) {
        return
      }

      const targetIndex =
        keyboardMode === 'present'
          ? getPresentKeyboardTargetIndex(event.key, activeSlideIndexRef.current, slideCount)
          : getPreviewKeyboardTargetIndex(event.key, activeSlideIndexRef.current, slideCount)

      if (targetIndex === null) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (targetIndex !== activeSlideIndexRef.current) {
        goToSlide(targetIndex)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled, goToSlide, keyboardMode, slideCount])

  useEffect(() => {
    if (!enabled || slideCount === 0 || !syncOnLoad) {
      return
    }

    const iframe = iframeRef.current

    if (!iframe) {
      return
    }

    const handleLoad = () => {
      goToSlide(activeSlideIndexRef.current)
    }

    iframe.addEventListener('load', handleLoad)

    return () => {
      iframe.removeEventListener('load', handleLoad)
    }
  }, [enabled, goToSlide, html, iframeRef, slideCount, syncOnLoad])

  return { activeSlideIndex, goToSlide }
}
