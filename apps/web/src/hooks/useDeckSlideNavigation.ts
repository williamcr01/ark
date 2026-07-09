import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import {
  createDeckGotoMessage,
  isDeckBridgeMessageFromRuntime,
  isDeckReadyMessage,
  isDeckRuntimeErrorMessage,
  isDeckSlideChangeMessage,
  type DeckMetadata,
} from '@ark/deck-core/deck-bridge.ts'
import {
  DECK_BRIDGE_POST_MESSAGE_TARGET,
  isAllowedBridgeMessageOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'
import type { DeckRuntimeMode } from '@/lib/deck-runtime'

const PREVIEW_NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
const PRESENT_NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', ' ', 'Spacebar', 'Enter', 'PageDown'])
const PRESENT_PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp'])

type DeckNavKeyboardMode = 'preview' | 'present' | 'off'

export type DeckNavOptions = {
  runtimeMode?: DeckRuntimeMode
  initialSlideIndex?: number
  keyboardMode?: DeckNavKeyboardMode
  shouldSuspendKeyboard?: () => boolean
  sandboxOrigin?: string | null
  onSlideChange?: (index: number) => void
  onDeckReady?: (payload: { index: number; slideCount: number; metadata: DeckMetadata }) => void
  onRuntimeError?: (message: string, source?: string) => void
  /**
   * @deprecated Independent load sync races the bridge session. Prefer
   * calling goToSlide from the session-gated onFrameLoad path when armed.
   */
  syncOnLoad?: boolean
  /** Synchronous send gate from usePreviewBridgeSession.canPostToFrame. */
  canPostToFrame?: () => boolean
  /** When false, ignore inbound bridge messages (session not armed). */
  shouldAcceptInbound?: () => boolean
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
    shouldSuspendKeyboard,
    sandboxOrigin = null,
    onSlideChange,
    onDeckReady,
    onRuntimeError,
    syncOnLoad = false,
    canPostToFrame,
    shouldAcceptInbound,
  } = options
  const [activeSlideIndex, setActiveSlideIndex] = useState(() =>
    clampSlideIndex(initialSlideIndex, slideCount),
  )
  const prevHtmlRef = useRef(html)
  const activeSlideIndexRef = useRef(activeSlideIndex)
  const iframeGenerationRef = useRef(0)
  const canPostToFrameRef = useRef(canPostToFrame)
  const shouldAcceptInboundRef = useRef(shouldAcceptInbound)
  const pendingFrameSyncIndexRef = useRef<number | null>(
    syncOnLoad ? clampSlideIndex(initialSlideIndex, slideCount) : null,
  )

  useEffect(() => {
    canPostToFrameRef.current = canPostToFrame
    shouldAcceptInboundRef.current = shouldAcceptInbound
  }, [canPostToFrame, shouldAcceptInbound])

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
    iframeGenerationRef.current += 1
    pendingFrameSyncIndexRef.current = syncOnLoad
      ? clampSlideIndex(activeSlideIndexRef.current, slideCount)
      : null
  }, [html, sandboxOrigin, slideCount, syncOnLoad])

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

      if (pendingFrameSyncIndexRef.current !== null) {
        pendingFrameSyncIndexRef.current = clampedIndex
      }

      if (canPostToFrameRef.current && !canPostToFrameRef.current()) {
        return
      }

      const iframeWindow = iframeRef.current?.contentWindow

      if (!iframeWindow) {
        return
      }

      iframeWindow.postMessage(createDeckGotoMessage(clampedIndex), DECK_BRIDGE_POST_MESSAGE_TARGET)
    },
    [commitSlideIndex, iframeRef, slideCount],
  )

  useEffect(() => {
    if (!enabled) {
      return
    }

    const messageGeneration = iframeGenerationRef.current

    const handleMessage = (event: MessageEvent) => {
      if (messageGeneration !== iframeGenerationRef.current) {
        return
      }

      if (shouldAcceptInboundRef.current && !shouldAcceptInboundRef.current()) {
        return
      }

      const iframeWindow = iframeRef.current?.contentWindow

      if (!iframeWindow || event.source !== iframeWindow) {
        return
      }

      if (!isAllowedBridgeMessageOrigin(event.origin, sandboxOrigin)) {
        return
      }

      const data = event.data

      if (!isDeckBridgeMessageFromRuntime(data)) {
        return
      }

      const syncPendingFrameIndex = (reportedIndex: number) => {
        const pendingIndex = pendingFrameSyncIndexRef.current

        if (pendingIndex === null) {
          return false
        }

        const targetIndex = clampSlideIndex(pendingIndex, slideCount)

        if (targetIndex === clampSlideIndex(reportedIndex, slideCount)) {
          pendingFrameSyncIndexRef.current = null
          commitSlideIndex(targetIndex)
          return true
        }

        commitSlideIndex(targetIndex)

        if (canPostToFrameRef.current && !canPostToFrameRef.current()) {
          return true
        }

        iframeWindow.postMessage(
          createDeckGotoMessage(targetIndex),
          DECK_BRIDGE_POST_MESSAGE_TARGET,
        )
        return true
      }

      if (isDeckReadyMessage(data)) {
        onDeckReady?.({
          index: data.index,
          slideCount: data.slideCount,
          metadata: data.metadata,
        })

        if (syncPendingFrameIndex(data.index)) {
          return
        }

        commitSlideIndex(data.index)
        return
      }

      if (isDeckRuntimeErrorMessage(data)) {
        onRuntimeError?.(data.message, data.source)
        return
      }

      if (isDeckSlideChangeMessage(data)) {
        if (syncPendingFrameIndex(data.index)) {
          return
        }

        commitSlideIndex(data.index)
      }
    }

    window.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [
    commitSlideIndex,
    enabled,
    iframeRef,
    onDeckReady,
    onRuntimeError,
    sandboxOrigin,
    slideCount,
    syncOnLoad,
  ])

  useEffect(() => {
    if (!enabled || slideCount === 0 || keyboardMode === 'off') {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldSuspendKeyboard?.()) {
        return
      }

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
  }, [enabled, goToSlide, keyboardMode, shouldSuspendKeyboard, slideCount])

  // Intentionally no independent iframe `load` → postMessage path. Load-driven
  // sync must go through usePreviewBridgeSession.onFrameLoad so compromise
  // flips the send gate before any outbound command.

  return { activeSlideIndex, goToSlide }
}
