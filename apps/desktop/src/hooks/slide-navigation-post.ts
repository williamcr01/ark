import type { MutableRefObject, RefObject } from 'react'

import {
  createDeckGotoMessage,
  createDeckPatchSlidesMessage,
} from '@ark/deck-preview/deck-bridge.ts'
import { resolvePatchActiveSlideIndex, type DeckSlidePatch } from '@ark/deck-preview/slide-patch.ts'
import { DECK_BRIDGE_POST_MESSAGE_TARGET } from '@ark/runtime-registry/sandbox-origin.ts'
import { clampSlideIndex } from '@/lib/deck/slide-navigation-keys.ts'

export const SLIDE_PATCH_TIMEOUT_MS = 2_000

export function postDeckGoto(
  index: number,
  slideCount: number,
  iframeRef: RefObject<HTMLIFrameElement | null>,
  pendingFrameSyncIndexRef: MutableRefObject<number | null>,
  canPostToFrameRef: MutableRefObject<(() => boolean) | undefined>,
  commitSlideIndex: (index: number, boundSlideCount?: number) => void,
) {
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
}

export function postDeckSlidePatch(
  patch: DeckSlidePatch,
  args: {
    iframeRef: RefObject<HTMLIFrameElement | null>
    activeSlideIndexRef: MutableRefObject<number>
    canPostToFrameRef: MutableRefObject<(() => boolean) | undefined>
    pendingSlidePatchRef: MutableRefObject<{ patchId: string; slideCount: number } | null>
    patchSequenceRef: MutableRefObject<number>
    patchTimeoutRef: MutableRefObject<number | null>
    onSlidePatchFailedRef: MutableRefObject<(() => void) | undefined>
    commitSlideIndex: (index: number, boundSlideCount?: number) => void
    clearPatchTimeout: () => void
  },
) {
  if (args.canPostToFrameRef.current && !args.canPostToFrameRef.current()) {
    return false
  }

  const iframeWindow = args.iframeRef.current?.contentWindow
  if (!iframeWindow) {
    return false
  }

  const targetIndex = resolvePatchActiveSlideIndex(patch, args.activeSlideIndexRef.current)
  if (args.activeSlideIndexRef.current !== targetIndex) {
    args.commitSlideIndex(targetIndex, patch.slideCount)
  }

  args.patchSequenceRef.current += 1
  const patchId = `slide-patch-${args.patchSequenceRef.current}`
  args.pendingSlidePatchRef.current = { patchId, slideCount: patch.slideCount }
  args.clearPatchTimeout()
  iframeWindow.postMessage(
    createDeckPatchSlidesMessage(patchId, patch.operations, targetIndex),
    DECK_BRIDGE_POST_MESSAGE_TARGET,
  )

  args.patchTimeoutRef.current = window.setTimeout(() => {
    args.patchTimeoutRef.current = null
    if (args.pendingSlidePatchRef.current?.patchId !== patchId) {
      return
    }

    args.pendingSlidePatchRef.current = null
    args.onSlidePatchFailedRef.current?.()
  }, SLIDE_PATCH_TIMEOUT_MS)

  return true
}
