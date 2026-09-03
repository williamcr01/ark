import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

import type { DeckSlidePatch } from '@ark/deck-preview/slide-patch.ts'
import type { DeckBrowserAnalysis } from '@/lib/deck/deck-analysis'
import type { DeckPreviewHandle } from '@/lib/deck/deck-preview-handle'
import { compromiseReasonMessage } from '@/lib/deck/runtime-error-reporting.ts'
import { getPreviewFrameScale } from '@/lib/deck/deck-preview'
import { useElementSize } from '@/hooks/useElementSize'
import { useDeckPreviewFrame } from '@/hooks/useDeckPreviewFrame'
import { useDeckPreviewSource } from '@/hooks/useDeckPreviewSource'
import { useDeckSlideNavigation } from '@/hooks/useDeckSlideNavigation'
import {
  usePreviewBridgeSession,
  type PreviewBridgeCompromiseReason,
} from '@/hooks/usePreviewBridgeSession'
import { useDeckPreviewRuntimeError } from '@/hooks/useDeckPreviewRuntimeError'
import { useDeckPreviewPresent } from '@/hooks/useDeckPreviewPresent'
import { useChatStore, type ChatStore } from '@/state/chat-store.ts'
import { useDeckStore } from '@/state/deck-store.ts'

const recentGenerationJobIdSelector = (documentRevision: number | null) => (state: ChatStore) => {
  const job = state.activeJob
  if (
    job?.status === 'succeeded' &&
    documentRevision !== null &&
    job.result?.documentRevision === documentRevision
  ) {
    return job.id
  }
  return null
}

function dispatchQueuedSlidePatch(
  patch: DeckSlidePatch,
  canPatchSlidesRef: { current: boolean },
  dispatchSlidePatchRef: { current: ((patch: DeckSlidePatch) => boolean) | null },
  clearSelectionRef: { current: (() => boolean) | null },
) {
  if (!canPatchSlidesRef.current || !dispatchSlidePatchRef.current?.(patch)) {
    return false
  }
  clearSelectionRef.current?.()
  return true
}

export function useDeckPreviewSession(
  analysis: DeckBrowserAnalysis,
  options: {
    initialSlideIndex?: number
    presentHandleRef?: RefObject<DeckPreviewHandle | null>
  } = {},
) {
  const { initialSlideIndex = 0, presentHandleRef } = options
  const shell = useDeckPreviewSessionShell(analysis.slideCount)

  const source = useDeckPreviewSource(shell.deckId, shell.html, {
    onSlidePatch: shell.dispatchSlidePatch,
  })
  const previewFrame = useDeckPreviewFrame(
    source.previewHtml,
    shell.previewEnabled,
    source.previewReloadRevision,
    shell.deckId,
  )
  const runtimeError = useDeckPreviewRuntimeError(analysis, {
    deckId: shell.deckId,
    documentRevision: shell.documentRevision,
    recentGenerationJobId: shell.recentGenerationJobId,
    activeSlideIndexRef: shell.activeSlideIndexRef,
    iframeKey: previewFrame.iframeKey,
  })

  const captureRuntimeError = runtimeError.captureRuntimeError
  const reportNavigationCompromise = useCallback(
    (reason: PreviewBridgeCompromiseReason) => {
      captureRuntimeError(compromiseReasonMessage(reason), 'preview-navigation-guard', false)
    },
    [captureRuntimeError],
  )

  const bridgeSession = usePreviewBridgeSession(previewFrame.iframeKey, {
    enabled: shell.previewEnabled && Boolean(previewFrame.handshake?.trim()),
    handshake: previewFrame.handshake,
    frameRef: shell.iframeRef,
    sandboxOrigin: previewFrame.sandboxOrigin,
    onCompromised: reportNavigationCompromise,
  })
  const previewCompromised = bridgeSession.compromised
  const bridgeEnabled = shell.previewEnabled && !previewCompromised

  const navigation = useDeckSlideNavigation(
    shell.iframeRef,
    analysis.slideCount,
    source.previewHtml,
    bridgeEnabled,
    {
      initialSlideIndex,
      keyboardMode: previewCompromised ? 'off' : shell.isPresentOpen ? 'present' : 'preview',
      shouldSuspendKeyboard: () => shell.textEditActiveRef.current,
      sandboxOrigin: previewFrame.sandboxOrigin,
      reloadRevision: source.previewReloadRevision,
      canPostToFrame: bridgeSession.canPostToFrame,
      shouldAcceptInbound: bridgeSession.shouldAcceptInbound,
      onRuntimeError: captureRuntimeError,
      onSlidePatchFailed: source.rollbackLivePatch,
    },
  )

  const present = useDeckPreviewPresent({
    presentHandleRef,
    goToSlide: navigation.goToSlide,
    activeSlideIndexRef: shell.activeSlideIndexRef,
    isPresentOpen: shell.isPresentOpen,
    setIsPresentOpen: shell.setIsPresentOpen,
  })
  const presentSize = present.presentViewportSize
  const effectivePreviewViewportSize =
    shell.isPresentOpen && presentSize.width > 0 && presentSize.height > 0
      ? presentSize
      : shell.previewViewportSize

  useDeckPreviewPatchBinding({
    navigation,
    previewEnabled: shell.previewEnabled,
    bridgeEnabled,
    armed: bridgeSession.armed,
    previewFrame,
    dispatchSlidePatchRef: shell.dispatchSlidePatchRef,
    canPatchSlidesRef: shell.canPatchSlidesRef,
    textEditActiveRef: shell.textEditActiveRef,
    activeSlideIndexRef: shell.activeSlideIndexRef,
  })

  return assembleDeckPreviewSession({
    analysis,
    bridgeEnabled,
    bridgeSession,
    editChromeActive: shell.previewEnabled && !shell.isGenerating && !shell.isPresentOpen,
    effectivePreviewViewportSize,
    iframeRef: shell.iframeRef,
    isPresentOpen: shell.isPresentOpen,
    navigation,
    present,
    previewCompromised,
    previewEnabled: shell.previewEnabled,
    previewFrame,
    previewStageRef: shell.previewStageRef,
    previewViewportRef: shell.previewViewportRef,
    previewViewportSize: shell.previewViewportSize,
    runtimeError,
    setIsPresentOpen: shell.setIsPresentOpen,
    source,
    activeSlideIndexRef: shell.activeSlideIndexRef,
    clearSelectionRef: shell.clearSelectionRef,
    textEditActiveRef: shell.textEditActiveRef,
  })
}

function assembleDeckPreviewSession(args: {
  analysis: DeckBrowserAnalysis
  bridgeEnabled: boolean
  bridgeSession: ReturnType<typeof usePreviewBridgeSession>
  editChromeActive: boolean
  effectivePreviewViewportSize: { width: number; height: number }
  iframeRef: RefObject<HTMLIFrameElement | null>
  isPresentOpen: boolean
  navigation: ReturnType<typeof useDeckSlideNavigation>
  present: ReturnType<typeof useDeckPreviewPresent>
  previewCompromised: boolean
  previewEnabled: boolean
  previewFrame: ReturnType<typeof useDeckPreviewFrame>
  previewStageRef: RefObject<HTMLDivElement | null>
  previewViewportRef: RefObject<HTMLDivElement | null>
  previewViewportSize: { width: number; height: number }
  runtimeError: ReturnType<typeof useDeckPreviewRuntimeError>
  setIsPresentOpen: (open: boolean) => void
  source: ReturnType<typeof useDeckPreviewSource>
  activeSlideIndexRef: { current: number }
  clearSelectionRef: { current: (() => boolean) | null }
  textEditActiveRef: { current: boolean }
}) {
  return {
    analysis: args.analysis,
    chrome: {
      bridgeEnabled: args.bridgeEnabled,
      editChromeActive: args.editChromeActive,
      isPresentOpen: args.isPresentOpen,
      previewCompromised: args.previewCompromised,
      previewCompromiseReason: args.bridgeSession.compromiseReason,
      previewEnabled: args.previewEnabled,
    },
    frame: {
      iframeRef: args.iframeRef,
      previewFrame: args.previewFrame,
      previewFrameScale: getPreviewFrameScale(args.effectivePreviewViewportSize),
      previewStageRef: args.previewStageRef,
      previewViewportRef: args.previewViewportRef,
      previewViewportSize: args.previewViewportSize,
    },
    navigation: args.navigation,
    present: {
      handlePresentViewportSizeChange: args.present.handlePresentViewportSizeChange,
      openPresentMode: args.present.openPresentMode,
      pendingPresentExitIndexRef: args.present.pendingPresentExitIndexRef,
      setIsPresentOpen: args.setIsPresentOpen,
    },
    refs: {
      activeSlideIndexRef: args.activeSlideIndexRef,
      clearSelectionRef: args.clearSelectionRef,
      textEditActiveRef: args.textEditActiveRef,
    },
    runtimeError: {
      notice: args.runtimeError.runtimeError,
      setNotice: args.runtimeError.setRuntimeError,
    },
    session: args.bridgeSession,
    source: args.source,
  }
}

function useDeckPreviewSessionShell(slideCount: number) {
  const html = useDeckStore((state) => state.html)
  const deckId = useDeckStore((state) => state.deckId)
  const documentRevision = useDeckStore((state) => state.documentRevision)
  const recentGenerationJobId = useChatStore(recentGenerationJobIdSelector(documentRevision))
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previewStageRef = useRef<HTMLDivElement>(null)
  const [previewViewportRef, previewViewportSize] = useElementSize<HTMLDivElement>()
  const [isPresentOpen, setIsPresentOpen] = useState(false)
  const dispatchSlidePatchRef = useRef<((patch: DeckSlidePatch) => boolean) | null>(null)
  const canPatchSlidesRef = useRef(false)
  const clearSelectionRef = useRef<(() => boolean) | null>(null)
  const activeSlideIndexRef = useRef(0)
  const textEditActiveRef = useRef(false)
  const isDeckLoading = useDeckStore((state) => state.isLoading)
  const isGenerating = useChatStore((state) => state.isGenerating)
  const previewEnabled = !isDeckLoading && html.length > 0 && slideCount > 0
  const dispatchSlidePatch = useCallback(
    (patch: DeckSlidePatch) =>
      dispatchQueuedSlidePatch(patch, canPatchSlidesRef, dispatchSlidePatchRef, clearSelectionRef),
    [],
  )
  return {
    html,
    deckId,
    documentRevision,
    recentGenerationJobId,
    iframeRef,
    previewStageRef,
    previewViewportRef,
    previewViewportSize,
    isPresentOpen,
    setIsPresentOpen,
    dispatchSlidePatchRef,
    canPatchSlidesRef,
    clearSelectionRef,
    activeSlideIndexRef,
    textEditActiveRef,
    isGenerating,
    previewEnabled,
    dispatchSlidePatch,
  }
}

function useDeckPreviewPatchBinding(args: {
  navigation: ReturnType<typeof useDeckSlideNavigation>
  previewEnabled: boolean
  bridgeEnabled: boolean
  armed: boolean
  previewFrame: ReturnType<typeof useDeckPreviewFrame>
  dispatchSlidePatchRef: { current: ((patch: DeckSlidePatch) => boolean) | null }
  canPatchSlidesRef: { current: boolean }
  textEditActiveRef: { current: boolean }
  activeSlideIndexRef: { current: number }
}) {
  useLayoutEffect(() => {
    args.dispatchSlidePatchRef.current = args.navigation.patchSlides
    args.canPatchSlidesRef.current =
      args.previewEnabled &&
      args.bridgeEnabled &&
      args.armed &&
      !args.previewFrame.isLoading &&
      !args.previewFrame.isStale &&
      !args.textEditActiveRef.current
  })

  useEffect(() => {
    args.activeSlideIndexRef.current = args.navigation.activeSlideIndex
  }, [args.activeSlideIndexRef, args.navigation.activeSlideIndex])
}
