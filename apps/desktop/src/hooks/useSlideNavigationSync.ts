import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react'

import type { DeckMetadata } from '@ark/deck-preview'
import type { DeckSlidePatch } from '@ark/deck-preview/slide-patch.ts'
import {
  getPresentKeyboardTargetIndex,
  getPreviewKeyboardTargetIndex,
  isActivatableTarget,
  isTypingTarget,
} from '@/lib/deck/slide-navigation-keys.ts'

import { handleSlideBridgeMessage, handleSlideKeyboard } from './slide-navigation-messages.ts'
import { postDeckGoto, postDeckSlidePatch } from './slide-navigation-post.ts'

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

  useEffect(() => () => clearPatchTimeout(), [clearPatchTimeout])
  useEffect(() => {
    iframeGenerationRef.current += 1
  }, [html, reloadRevision, sandboxOrigin, slideCount])
  useEffect(() => {
    pendingSlidePatchRef.current = null
    clearPatchTimeout()
  }, [clearPatchTimeout, html, reloadRevision, sandboxOrigin])

  const goToSlide = useCallback(
    (index: number) =>
      postDeckGoto(
        index,
        slideCount,
        iframeRef,
        pendingFrameSyncIndexRef,
        canPostToFrameRef,
        commitSlideIndex,
      ),
    [commitSlideIndex, iframeRef, pendingFrameSyncIndexRef, slideCount],
  )

  const patchSlides = useCallback(
    (patch: DeckSlidePatch) =>
      postDeckSlidePatch(patch, {
        iframeRef,
        activeSlideIndexRef,
        canPostToFrameRef,
        pendingSlidePatchRef,
        patchSequenceRef,
        patchTimeoutRef,
        onSlidePatchFailedRef,
        commitSlideIndex,
        clearPatchTimeout,
      }),
    [activeSlideIndexRef, clearPatchTimeout, commitSlideIndex, iframeRef],
  )

  useSlideNavigationListeners({
    iframeRef,
    iframeGenerationRef,
    shouldAcceptInboundRef,
    canPostToFrameRef,
    pendingSlidePatchRef,
    pendingFrameSyncIndexRef,
    onSlidePatchFailedRef,
    enabled,
    html,
    reloadRevision,
    sandboxOrigin,
    slideCount,
    clearPatchTimeout,
    commitSlideIndex,
    onDeckReady,
    onRuntimeError,
    keyboardMode,
    shouldSuspendKeyboard,
    activeSlideIndexRef,
    goToSlide,
  })

  return { goToSlide, patchSlides }
}

type SlideNavigationListenerArgs = {
  iframeRef: RefObject<HTMLIFrameElement | null>
  iframeGenerationRef: MutableRefObject<number>
  shouldAcceptInboundRef: MutableRefObject<(() => boolean) | undefined>
  canPostToFrameRef: MutableRefObject<(() => boolean) | undefined>
  pendingSlidePatchRef: MutableRefObject<{ patchId: string; slideCount: number } | null>
  pendingFrameSyncIndexRef: MutableRefObject<number | null>
  onSlidePatchFailedRef: MutableRefObject<(() => void) | undefined>
  enabled: boolean
  html: string
  reloadRevision: number
  sandboxOrigin: string | null
  slideCount: number
  clearPatchTimeout: () => void
  commitSlideIndex: (index: number, boundSlideCount?: number) => void
  onDeckReady?: UseSlideNavigationSyncOptions['onDeckReady']
  onRuntimeError?: UseSlideNavigationSyncOptions['onRuntimeError']
  keyboardMode: DeckNavKeyboardMode
  shouldSuspendKeyboard?: () => boolean
  activeSlideIndexRef: MutableRefObject<number>
  goToSlide: (index: number) => void
}

function useSlideNavigationListeners(args: SlideNavigationListenerArgs) {
  useSlideNavigationMessageListener(args)
  useSlideNavigationKeyboardListener(args)
}

function useSlideNavigationMessageListener({
  iframeRef,
  iframeGenerationRef,
  shouldAcceptInboundRef,
  canPostToFrameRef,
  pendingSlidePatchRef,
  pendingFrameSyncIndexRef,
  onSlidePatchFailedRef,
  enabled,
  html,
  reloadRevision,
  sandboxOrigin,
  slideCount,
  clearPatchTimeout,
  commitSlideIndex,
  onDeckReady,
  onRuntimeError,
}: SlideNavigationListenerArgs) {
  useEffect(() => {
    if (!enabled) {
      return
    }

    const messageGeneration = iframeGenerationRef.current
    const refs = {
      iframeRef,
      iframeGenerationRef,
      shouldAcceptInboundRef,
      canPostToFrameRef,
      pendingSlidePatchRef,
      pendingFrameSyncIndexRef,
      onSlidePatchFailedRef,
    }

    const handleMessage = (event: MessageEvent) => {
      handleSlideBridgeMessage(
        event,
        messageGeneration,
        refs,
        sandboxOrigin,
        slideCount,
        clearPatchTimeout,
        commitSlideIndex,
        onDeckReady,
        onRuntimeError,
      )
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [
    canPostToFrameRef,
    clearPatchTimeout,
    commitSlideIndex,
    enabled,
    html,
    iframeGenerationRef,
    iframeRef,
    onDeckReady,
    onRuntimeError,
    onSlidePatchFailedRef,
    pendingFrameSyncIndexRef,
    pendingSlidePatchRef,
    reloadRevision,
    sandboxOrigin,
    shouldAcceptInboundRef,
    slideCount,
  ])
}

function useSlideNavigationKeyboardListener({
  enabled,
  slideCount,
  keyboardMode,
  shouldSuspendKeyboard,
  activeSlideIndexRef,
  goToSlide,
}: SlideNavigationListenerArgs) {
  useEffect(() => {
    if (!enabled || slideCount === 0 || keyboardMode === 'off') {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      handleSlideKeyboard(event, {
        keyboardMode,
        shouldSuspendKeyboard,
        activeSlideIndexRef,
        slideCount,
        goToSlide,
        getPresentKeyboardTargetIndex,
        getPreviewKeyboardTargetIndex,
        isActivatableTarget,
        isTypingTarget,
      })
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [activeSlideIndexRef, enabled, goToSlide, keyboardMode, shouldSuspendKeyboard, slideCount])
}
