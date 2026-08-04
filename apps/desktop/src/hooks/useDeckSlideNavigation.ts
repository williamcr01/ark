import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import {
  createDeckGotoMessage,
  createDeckPatchSlidesMessage,
  isDeckBridgeMessageFromRuntime,
  isDeckPatchSlidesResultMessage,
  isDeckReadyMessage,
  isDeckRuntimeErrorMessage,
  isDeckSlideChangeMessage,
  type DeckMetadata,
} from '@ark/deck-core/deck-bridge.ts'
import {
  mapPreservedSlideIndexFromHtml,
  resolvePatchActiveSlideIndex,
  type DeckSlidePatch,
} from '@ark/deck-core/deck-slide-patch.ts'
import {
  DECK_BRIDGE_POST_MESSAGE_TARGET,
  isAllowedBridgeMessageOrigin,
  resolveAppOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'

const PREVIEW_NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
const PRESENT_NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', ' ', 'Spacebar', 'Enter', 'PageDown'])
const PRESENT_PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp'])

type DeckNavKeyboardMode = 'preview' | 'present' | 'off'

/** How long a dispatched slide patch may stay unacknowledged before reloading. */
const SLIDE_PATCH_TIMEOUT_MS = 2_000

export type DeckNavOptions = {
  initialSlideIndex?: number
  keyboardMode?: DeckNavKeyboardMode
  shouldSuspendKeyboard?: () => boolean
  sandboxOrigin?: string | null
  /**
   * Bumps when the preview frame must reload even if `html` is unchanged
   * (snapshot restore, failed live patch, same-HTML remount). Arms the pending-slide
   * sync so the reloaded frame does not stick on slide 0.
   */
  reloadRevision?: number
  onSlideChange?: (index: number) => void
  onDeckReady?: (payload: { index: number; slideCount: number; metadata: DeckMetadata }) => void
  onRuntimeError?: (message: string, source?: string) => void
  /**
   * Called when a dispatched slide patch did not land (runtime refused it,
   * produced an unexpected slide count, or never replied). The shell should
   * fall back to a full preview reload.
   */
  onSlidePatchFailed?: () => void
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
    reloadRevision = 0,
    onSlideChange,
    onDeckReady,
    onRuntimeError,
    onSlidePatchFailed,
    canPostToFrame,
    shouldAcceptInbound,
  } = options
  const [activeSlideIndex, setActiveSlideIndex] = useState(() =>
    clampSlideIndex(initialSlideIndex, slideCount),
  )
  const prevHtmlRef = useRef(html)
  const prevReloadRevisionRef = useRef(reloadRevision)
  const appliedInitialSlideRef = useRef(html.length > 0)
  const activeSlideIndexRef = useRef(activeSlideIndex)
  const iframeGenerationRef = useRef(0)
  const canPostToFrameRef = useRef(canPostToFrame)
  const shouldAcceptInboundRef = useRef(shouldAcceptInbound)
  const pendingFrameSyncIndexRef = useRef<number | null>(null)
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
    pendingFrameSyncIndexRef.current = null
  }, [html, reloadRevision, sandboxOrigin, slideCount])

  // Only a real frame reload drops an in-flight patch. A live patch changes
  // slideCount without reloading, and its reply still has to be honoured.
  useEffect(() => {
    pendingSlidePatchRef.current = null
    clearPatchTimeout()
  }, [clearPatchTimeout, html, reloadRevision, sandboxOrigin])

  useEffect(() => {
    if (prevHtmlRef.current === html) {
      return
    }

    const previousHtml = prevHtmlRef.current
    prevHtmlRef.current = html

    if (!html) {
      // Cleared deck (e.g. /decks/new) — allow the next load to deep-link again.
      appliedInitialSlideRef.current = false
      commitSlideIndex(0)
      return
    }

    // DeckPreview mounts empty while the route deck loads. Apply ?slide= on the
    // first empty→content transition.
    if (!previousHtml && !appliedInitialSlideRef.current) {
      appliedInitialSlideRef.current = true
      commitSlideIndex(initialSlideIndex)
      return
    }

    // Later HTML replacements keep the viewer on the same slide content when it
    // still exists. When it doesn't, clamping lands on whatever now holds that
    // numeric position. The frame reloads at slide 0, so arm the sync that
    // pushes it back.
    const preservedIndex = mapPreservedSlideIndexFromHtml(
      previousHtml,
      html,
      activeSlideIndexRef.current,
      slideCount,
      { assetOrigin: resolveAppOrigin() },
    )
    commitSlideIndex(preservedIndex)
    pendingFrameSyncIndexRef.current = preservedIndex
  }, [commitSlideIndex, html, initialSlideIndex, slideCount])

  // Same-HTML remounts (snapshot restore / failed patch) still need the preserved index
  // pushed back after the frame boots at slide 0.
  useEffect(() => {
    if (prevReloadRevisionRef.current === reloadRevision) {
      return
    }

    prevReloadRevisionRef.current = reloadRevision

    if (!html) {
      return
    }

    const preservedIndex = clampSlideIndex(activeSlideIndexRef.current, slideCount)
    commitSlideIndex(preservedIndex)
    pendingFrameSyncIndexRef.current = preservedIndex
  }, [commitSlideIndex, html, reloadRevision, slideCount])

  // Slides added or removed in place (live patch) can strand the active index
  // past the end of the deck.
  useEffect(() => {
    commitSlideIndex(activeSlideIndexRef.current)
  }, [commitSlideIndex, slideCount])

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

  /**
   * Ask the loaded preview to swap individual slides instead of reloading.
   * Returns false when the frame cannot be reached, so the caller can reload.
   */
  const patchSlides = useCallback(
    (patch: DeckSlidePatch) => {
      if (canPostToFrameRef.current && !canPostToFrameRef.current()) {
        return false
      }

      const iframeWindow = iframeRef.current?.contentWindow

      if (!iframeWindow) {
        return false
      }

      // Use the patch's predicted count so an insert can move the viewer past
      // the previous end before React commits the updated slideCount prop.
      const targetIndex = resolvePatchActiveSlideIndex(patch, activeSlideIndexRef.current)

      if (activeSlideIndexRef.current !== targetIndex) {
        activeSlideIndexRef.current = targetIndex
        setActiveSlideIndex(targetIndex)
        onSlideChange?.(targetIndex)
      }

      patchSequenceRef.current += 1
      const patchId = `slide-patch-${patchSequenceRef.current}`
      pendingSlidePatchRef.current = { patchId, slideCount: patch.slideCount }
      clearPatchTimeout()
      iframeWindow.postMessage(
        createDeckPatchSlidesMessage(patchId, patch.operations, targetIndex),
        DECK_BRIDGE_POST_MESSAGE_TARGET,
      )

      // A deck that never answers must not leave the preview showing stale slides.
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
    [clearPatchTimeout, iframeRef, onSlideChange],
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

        // A refused patch may have partially mutated the live DOM even when it
        // is no longer the pending id (a later patch already replaced it). Any
        // failure is enough to force a reload.
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

        // A slide count the shell did not predict means the runtime and the
        // canonical deck have diverged; only a reload can resolve that.
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
    // `html` / `reloadRevision` are dependencies because they bump the iframe
    // generation above; without them this listener keeps a stale generation and
    // drops every message the reloaded frame sends.
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

      // Leave Alt+Arrow available to focused shell controls such as thumbnail sorting.
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

      // Capture phase + preventDefault so focused chrome (e.g. the chat
      // panel resize separator) cannot consume arrows for layout changes.
      event.preventDefault()

      if (targetIndex !== activeSlideIndexRef.current) {
        goToSlide(targetIndex)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [enabled, goToSlide, keyboardMode, shouldSuspendKeyboard, slideCount])

  // Intentionally no independent iframe `load` → postMessage path. Load-driven
  // sync must go through usePreviewBridgeSession.onFrameLoad so compromise
  // flips the send gate before any outbound command.

  return { activeSlideIndex, goToSlide, patchSlides }
}
