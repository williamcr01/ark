import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react'

import {
  createDeckGotoMessage,
  createDeckPatchSlidesMessage,
  isDeckBridgeMessageFromRuntime,
  isDeckPatchSlidesResultMessage,
  isDeckReadyMessage,
  isDeckRuntimeErrorMessage,
  isDeckSlideChangeMessage,
  type DeckMetadata,
} from '@ark/deck-preview/deck-bridge.ts'
import { resolvePatchActiveSlideIndex, type DeckSlidePatch } from '@ark/deck-preview/slide-patch.ts'
import {
  DECK_BRIDGE_POST_MESSAGE_TARGET,
  isAllowedBridgeMessageOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'
import {
  clampSlideIndex,
  getPresentKeyboardTargetIndex,
  getPreviewKeyboardTargetIndex,
  isActivatableTarget,
  isTypingTarget,
} from '@/lib/deck/slide-navigation-keys.ts'

const SLIDE_PATCH_TIMEOUT_MS = 2_000

export type DeckNavKeyboardMode = 'preview' | 'present' | 'off'

export type UseSlideNavigationSyncOptions = {
  keyboardMode?: DeckNavKeyboardMode
  shouldSuspendKeyboard?: () => boolean
  sandboxOrigin?: string | null
  reloadRevision?: number
  onDeckReady?: (payload: { index: number; slideCount: number; metadata: DeckMetadata }) => void
  onRuntimeError?: (message: string, source?: string) => void
  onSlidePatchFailed?: () => void
  canPostToFrame?: () => boolean
  shouldAcceptInbound?: () => boolean
}

export function useSlideNavigationSync(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  slideCount: number,
  html: string,
  enabled: boolean,
  activeSlideIndexRef: MutableRefObject<number>,
  commitSlideIndex: (index: number, boundSlideCount?: number) => void,
  pendingFrameSyncIndexRef: MutableRefObject<number | null>,
  options: UseSlideNavigationSyncOptions = {},
) {
  const {
    keyboardMode = 'preview',
    shouldSuspendKeyboard,
    sandboxOrigin = null,
    reloadRevision = 0,
    onDeckReady,
    onRuntimeError,
    onSlidePatchFailed,
    canPostToFrame,
    shouldAcceptInbound,
  } = options
  const iframeGenerationRef = useRef(0)
  const canPostToFrameRef = useRef(canPostToFrame)
  const shouldAcceptInboundRef = useRef(shouldAcceptInbound)
  const onSlidePatchFailedRef = useRef(onSlidePatchFailed)
  const patchSequenceRef = useRef(0)
  const pendingSlidePatchRef = useRef<{ patchId: string; slideCount: number } | null>(null)
  const patchTimeoutRef = useRef<number | null>(null)

  const clearPatchTimeout = useCallback(() => {
    if (patchTimeoutRef.current === null) {
      return
    }

    window.clearTimeout(patchTimeoutRef.current)
    patchTimeoutRef.current = null
  }, [])

  useEffect(() => {
    canPostToFrameRef.current = canPostToFrame
    shouldAcceptInboundRef.current = shouldAcceptInbound
    onSlidePatchFailedRef.current = onSlidePatchFailed
  }, [canPostToFrame, onSlidePatchFailed, shouldAcceptInbound])

  useEffect(() => {
    return () => {
      clearPatchTimeout()
    }
  }, [clearPatchTimeout])

  useEffect(() => {
    iframeGenerationRef.current += 1
  }, [html, reloadRevision, sandboxOrigin, slideCount])

  useEffect(() => {
    pendingSlidePatchRef.current = null
    clearPatchTimeout()
  }, [clearPatchTimeout, html, reloadRevision, sandboxOrigin])

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

  const patchSlides = useCallback(
    (patch: DeckSlidePatch) => {
      if (canPostToFrameRef.current && !canPostToFrameRef.current()) {
        return false
      }

      const iframeWindow = iframeRef.current?.contentWindow
      if (!iframeWindow) {
        return false
      }

      const targetIndex = resolvePatchActiveSlideIndex(patch, activeSlideIndexRef.current)
      if (activeSlideIndexRef.current !== targetIndex) {
        commitSlideIndex(targetIndex, patch.slideCount)
      }

      patchSequenceRef.current += 1
      const patchId = `slide-patch-${patchSequenceRef.current}`
      pendingSlidePatchRef.current = { patchId, slideCount: patch.slideCount }
      clearPatchTimeout()
      iframeWindow.postMessage(
        createDeckPatchSlidesMessage(patchId, patch.operations, targetIndex),
        DECK_BRIDGE_POST_MESSAGE_TARGET,
      )

      patchTimeoutRef.current = window.setTimeout(() => {
        patchTimeoutRef.current = null
        if (pendingSlidePatchRef.current?.patchId !== patchId) {
          return
        }

        pendingSlidePatchRef.current = null
        onSlidePatchFailedRef.current?.()
      }, SLIDE_PATCH_TIMEOUT_MS)

      return true
    },
    [activeSlideIndexRef, clearPatchTimeout, commitSlideIndex, iframeRef],
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

      if (isDeckPatchSlidesResultMessage(data)) {
        const pending = pendingSlidePatchRef.current
        if (!data.applied) {
          if (pending?.patchId === data.patchId) {
            pendingSlidePatchRef.current = null
            clearPatchTimeout()
          }

          onSlidePatchFailedRef.current?.()
          return
        }

        if (!pending || pending.patchId !== data.patchId) {
          return
        }

        pendingSlidePatchRef.current = null
        clearPatchTimeout()
        if (data.slideCount !== pending.slideCount) {
          onSlidePatchFailedRef.current?.()
        }

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
    clearPatchTimeout,
    commitSlideIndex,
    enabled,
    html,
    iframeRef,
    onDeckReady,
    onRuntimeError,
    reloadRevision,
    sandboxOrigin,
    slideCount,
  ])

  useEffect(() => {
    if (!enabled || slideCount === 0 || keyboardMode === 'off') {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldSuspendKeyboard?.()) {
        return
      }

      if (event.altKey) {
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
      if (targetIndex !== activeSlideIndexRef.current) {
        goToSlide(targetIndex)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [activeSlideIndexRef, enabled, goToSlide, keyboardMode, shouldSuspendKeyboard, slideCount])

  return { goToSlide, patchSlides }
}
