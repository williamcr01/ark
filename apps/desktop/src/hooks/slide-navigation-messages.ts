import {
  createDeckGotoMessage,
  isDeckBridgeMessageFromRuntime,
  isDeckPatchSlidesResultMessage,
  isDeckReadyMessage,
  isDeckRuntimeErrorMessage,
  isDeckSlideChangeMessage,
  type DeckMetadata,
} from '@ark/deck-preview'
import {
  DECK_BRIDGE_POST_MESSAGE_TARGET,
  isAllowedBridgeMessageOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'
import { clampSlideIndex } from '@/lib/deck/slide-navigation-keys.ts'
import type { MutableRefObject, RefObject } from 'react'

export type SlideBridgeHandlerRefs = {
  iframeRef: RefObject<HTMLIFrameElement | null>
  iframeGenerationRef: MutableRefObject<number>
  shouldAcceptInboundRef: MutableRefObject<(() => boolean) | undefined>
  canPostToFrameRef: MutableRefObject<(() => boolean) | undefined>
  pendingSlidePatchRef: MutableRefObject<{ patchId: string; slideCount: number } | null>
  pendingFrameSyncIndexRef: MutableRefObject<number | null>
  onSlidePatchFailedRef: MutableRefObject<(() => void) | undefined>
}

function syncPendingFrameIndex(
  reportedIndex: number,
  iframeWindow: Window,
  refs: SlideBridgeHandlerRefs,
  slideCount: number,
  commitSlideIndex: (index: number, boundSlideCount?: number) => void,
) {
  const pendingIndex = refs.pendingFrameSyncIndexRef.current
  if (pendingIndex === null) {
    return false
  }

  const targetIndex = clampSlideIndex(pendingIndex, slideCount)
  if (targetIndex === clampSlideIndex(reportedIndex, slideCount)) {
    refs.pendingFrameSyncIndexRef.current = null
    commitSlideIndex(targetIndex)
    return true
  }

  commitSlideIndex(targetIndex)
  if (refs.canPostToFrameRef.current && !refs.canPostToFrameRef.current()) {
    return true
  }

  iframeWindow.postMessage(createDeckGotoMessage(targetIndex), DECK_BRIDGE_POST_MESSAGE_TARGET)
  return true
}

export function handleSlideBridgeMessage(
  event: MessageEvent,
  messageGeneration: number,
  refs: SlideBridgeHandlerRefs,
  sandboxOrigin: string | null,
  slideCount: number,
  clearPatchTimeout: () => void,
  commitSlideIndex: (index: number, boundSlideCount?: number) => void,
  onDeckReady?: (payload: { index: number; slideCount: number; metadata: DeckMetadata }) => void,
  onRuntimeError?: (message: string, source?: string) => void,
) {
  if (messageGeneration !== refs.iframeGenerationRef.current) {
    return
  }

  if (refs.shouldAcceptInboundRef.current && !refs.shouldAcceptInboundRef.current()) {
    return
  }

  const iframeWindow = refs.iframeRef.current?.contentWindow
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
    const pending = refs.pendingSlidePatchRef.current
    if (!data.applied) {
      if (pending?.patchId === data.patchId) {
        refs.pendingSlidePatchRef.current = null
        clearPatchTimeout()
      }

      refs.onSlidePatchFailedRef.current?.()
      return
    }

    if (!pending || pending.patchId !== data.patchId) {
      return
    }

    refs.pendingSlidePatchRef.current = null
    clearPatchTimeout()
    if (data.slideCount !== pending.slideCount) {
      refs.onSlidePatchFailedRef.current?.()
    }

    return
  }

  if (isDeckReadyMessage(data)) {
    onDeckReady?.({
      index: data.index,
      slideCount: data.slideCount,
      metadata: data.metadata,
    })
    if (syncPendingFrameIndex(data.index, iframeWindow, refs, slideCount, commitSlideIndex)) {
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
    if (syncPendingFrameIndex(data.index, iframeWindow, refs, slideCount, commitSlideIndex)) {
      return
    }

    commitSlideIndex(data.index)
  }
}

export function handleSlideKeyboard(
  event: KeyboardEvent,
  args: {
    keyboardMode: 'preview' | 'present' | 'off'
    shouldSuspendKeyboard?: () => boolean
    activeSlideIndexRef: MutableRefObject<number>
    slideCount: number
    goToSlide: (index: number) => void
    getPresentKeyboardTargetIndex: (
      key: string,
      current: number,
      slideCount: number,
    ) => number | null
    getPreviewKeyboardTargetIndex: (
      key: string,
      current: number,
      slideCount: number,
    ) => number | null
    isActivatableTarget: (target: EventTarget | null) => boolean
    isTypingTarget: (target: EventTarget | null) => boolean
  },
) {
  if (args.shouldSuspendKeyboard?.()) {
    return
  }

  if (event.altKey) {
    return
  }

  if (args.isTypingTarget(event.target)) {
    return
  }

  if (args.keyboardMode === 'present' && args.isActivatableTarget(event.target)) {
    return
  }

  const targetIndex =
    args.keyboardMode === 'present'
      ? args.getPresentKeyboardTargetIndex(
          event.key,
          args.activeSlideIndexRef.current,
          args.slideCount,
        )
      : args.getPreviewKeyboardTargetIndex(
          event.key,
          args.activeSlideIndexRef.current,
          args.slideCount,
        )

  if (targetIndex === null) {
    return
  }

  event.preventDefault()
  if (targetIndex !== args.activeSlideIndexRef.current) {
    args.goToSlide(targetIndex)
  }
}
