import { type RefObject } from 'react'

import type { DeckMetadata } from '@ark/deck-preview'

import { useSlideIndex } from './useSlideIndex.ts'
import { useSlideNavigationSync, type DeckNavKeyboardMode } from './useSlideNavigationSync.ts'

export type DeckNavOptions = {
  initialSlideIndex?: number
  keyboardMode?: DeckNavKeyboardMode
  shouldSuspendKeyboard?: () => boolean
  sandboxOrigin?: string | null
  reloadRevision?: number
  onSlideChange?: (index: number) => void
  onDeckReady?: (payload: { index: number; slideCount: number; metadata: DeckMetadata }) => void
  onRuntimeError?: (message: string, source?: string) => void
  onSlidePatchFailed?: () => void
  canPostToFrame?: () => boolean
  shouldAcceptInbound?: () => boolean
}

export function useDeckSlideNavigation(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  slideCount: number,
  html: string,
  enabled: boolean,
  options: DeckNavOptions = {},
) {
  const { activeSlideIndex, activeSlideIndexRef, commitSlideIndex, pendingFrameSyncIndexRef } =
    useSlideIndex(slideCount, html, {
      initialSlideIndex: options.initialSlideIndex,
      reloadRevision: options.reloadRevision,
      sandboxOrigin: options.sandboxOrigin,
      onSlideChange: options.onSlideChange,
    })
  const { goToSlide, patchSlides } = useSlideNavigationSync(
    iframeRef,
    slideCount,
    html,
    enabled,
    activeSlideIndexRef,
    commitSlideIndex,
    pendingFrameSyncIndexRef,
    options,
  )

  return { activeSlideIndex, goToSlide, patchSlides }
}
