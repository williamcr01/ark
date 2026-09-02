import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

import type { DeckSlidePatch } from '@ark/deck-preview/slide-patch.ts'
import type { DeckBrowserAnalysis } from '@/lib/deck/deck-analysis'
import type { DeckPreviewHandle } from '@/lib/deck/deck-preview-handle'
import {
  buildRuntimeErrorInput,
  compromiseReasonMessage,
  fingerprintRuntimeError,
  normalizeRuntimeErrorReport,
  reportCapturedRuntimeError,
  shouldReportRuntimeError,
  type RuntimeErrorNotice,
} from '@/lib/deck/runtime-error-reporting.ts'
import { getPreviewFrameScale } from '@/lib/deck/deck-preview'
import { useElementSize } from '@/hooks/useElementSize'
import { useDeckPreviewFrame } from '@/hooks/useDeckPreviewFrame'
import { useDeckPreviewSource } from '@/hooks/useDeckPreviewSource'
import { useDeckSlideNavigation } from '@/hooks/useDeckSlideNavigation'
import {
  usePreviewBridgeSession,
  type PreviewBridgeCompromiseReason,
} from '@/hooks/usePreviewBridgeSession'
import { useChatStore } from '@/state/chat-store.ts'
import { useDeckStore } from '@/state/deck-store.ts'

export function useDeckPreviewSession(
  analysis: DeckBrowserAnalysis,
  options: {
    initialSlideIndex?: number
    presentHandleRef?: RefObject<DeckPreviewHandle | null>
  } = {},
) {
  const { initialSlideIndex = 0, presentHandleRef } = options
  const html = useDeckStore((state) => state.html)
  const deckId = useDeckStore((state) => state.deckId)
  const documentRevision = useDeckStore((state) => state.documentRevision)
  const recentGenerationJobId = useChatStore((state) => {
    const job = state.activeJob
    if (
      job?.status === 'succeeded' &&
      documentRevision !== null &&
      job.result?.documentRevision === documentRevision
    ) {
      return job.id
    }
    return null
  })
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previewStageRef = useRef<HTMLDivElement>(null)
  const [previewViewportRef, previewViewportSize] = useElementSize<HTMLDivElement>()
  const [isPresentOpen, setIsPresentOpen] = useState(false)
  const [presentViewportSize, setPresentViewportSize] = useState(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }))
  const pendingPresentExitIndexRef = useRef<number | null>(null)
  const dispatchSlidePatchRef = useRef<((patch: DeckSlidePatch) => boolean) | null>(null)
  const canPatchSlidesRef = useRef(false)
  const clearSelectionRef = useRef<(() => boolean) | null>(null)
  const reportedRuntimeErrorsRef = useRef(new Set<string>())
  const activeSlideIndexRef = useRef(0)
  const textEditActiveRef = useRef(false)
  const [runtimeError, setRuntimeError] = useState<RuntimeErrorNotice | null>(null)

  const effectivePreviewViewportSize =
    isPresentOpen && presentViewportSize.width > 0 && presentViewportSize.height > 0
      ? presentViewportSize
      : previewViewportSize
  const previewFrameScale = getPreviewFrameScale(effectivePreviewViewportSize)
  const runtimeManifest = analysis.runtimeManifest
  const runtimeMode = runtimeManifest.runtimeMode
  const validation = analysis.validation
  const hasSlides = analysis.slideCount > 0
  const isDeckLoading = useDeckStore((state) => state.isLoading)
  const isGenerating = useChatStore((state) => state.isGenerating)
  const previewEnabled = !isDeckLoading && html.length > 0 && hasSlides
  const editChromeActive = previewEnabled && !isGenerating && !isPresentOpen

  const dispatchSlidePatch = useCallback((patch: DeckSlidePatch) => {
    if (!canPatchSlidesRef.current || !dispatchSlidePatchRef.current?.(patch)) {
      return false
    }
    clearSelectionRef.current?.()
    return true
  }, [])

  const source = useDeckPreviewSource(deckId, html, { onSlidePatch: dispatchSlidePatch })
  const previewFrame = useDeckPreviewFrame(
    source.previewHtml,
    previewEnabled,
    source.previewReloadRevision,
    deckId,
  )

  const captureRuntimeError = useCallback(
    (rawMessage: string, rawSource?: string | null, showNotice = true) => {
      const { message, source: errorSource } = normalizeRuntimeErrorReport(rawMessage, rawSource)
      if (!message) {
        return
      }

      const fingerprint = fingerprintRuntimeError(message, errorSource)
      const isNavigationGuard = errorSource === 'preview-navigation-guard'
      if (
        !shouldReportRuntimeError(reportedRuntimeErrorsRef.current, fingerprint, isNavigationGuard)
      ) {
        return
      }

      reportedRuntimeErrorsRef.current.add(fingerprint)
      const slideIndex = activeSlideIndexRef.current
      if (showNotice) {
        setRuntimeError({ deckId, message, slideIndex, documentRevision })
      }

      reportCapturedRuntimeError(
        reportedRuntimeErrorsRef.current,
        fingerprint,
        buildRuntimeErrorInput(
          { deckId, documentRevision, slideIndex, message, source: errorSource },
          {
            runtimeMode,
            previewMode: runtimeManifest.previewMode,
            approvedRuntime: runtimeManifest.approvedRuntime,
            validationValid: validation.valid,
            validationErrors: runtimeManifest.validation.errors,
            validationWarnings: runtimeManifest.validation.warnings,
            relatedJobId: recentGenerationJobId,
          },
        ),
      )
    },
    [
      deckId,
      documentRevision,
      recentGenerationJobId,
      runtimeManifest.approvedRuntime,
      runtimeManifest.previewMode,
      runtimeManifest.validation.errors,
      runtimeManifest.validation.warnings,
      runtimeMode,
      validation.valid,
    ],
  )

  const reportNavigationCompromise = useCallback(
    (reason: PreviewBridgeCompromiseReason) => {
      captureRuntimeError(compromiseReasonMessage(reason), 'preview-navigation-guard', false)
    },
    [captureRuntimeError],
  )

  const bridgeSession = usePreviewBridgeSession(previewFrame.iframeKey, {
    enabled: previewEnabled && Boolean(previewFrame.handshake?.trim()),
    handshake: previewFrame.handshake,
    frameRef: iframeRef,
    sandboxOrigin: previewFrame.sandboxOrigin,
    onCompromised: reportNavigationCompromise,
  })
  const previewCompromised = bridgeSession.compromised
  const bridgeEnabled = previewEnabled && !previewCompromised

  const navigation = useDeckSlideNavigation(
    iframeRef,
    analysis.slideCount,
    source.previewHtml,
    bridgeEnabled,
    {
      initialSlideIndex,
      keyboardMode: previewCompromised ? 'off' : isPresentOpen ? 'present' : 'preview',
      shouldSuspendKeyboard: () => textEditActiveRef.current,
      sandboxOrigin: previewFrame.sandboxOrigin,
      reloadRevision: source.previewReloadRevision,
      canPostToFrame: bridgeSession.canPostToFrame,
      shouldAcceptInbound: bridgeSession.shouldAcceptInbound,
      onRuntimeError: captureRuntimeError,
      onSlidePatchFailed: source.rollbackLivePatch,
    },
  )

  useLayoutEffect(() => {
    dispatchSlidePatchRef.current = navigation.patchSlides
    canPatchSlidesRef.current =
      previewEnabled &&
      bridgeEnabled &&
      bridgeSession.armed &&
      !previewFrame.isLoading &&
      !previewFrame.isStale &&
      !textEditActiveRef.current
  })

  useEffect(() => {
    activeSlideIndexRef.current = navigation.activeSlideIndex
  }, [navigation.activeSlideIndex])

  useEffect(() => {
    for (const fingerprint of reportedRuntimeErrorsRef.current) {
      if (fingerprint.endsWith(':preview-navigation-guard')) {
        reportedRuntimeErrorsRef.current.delete(fingerprint)
      }
    }
  }, [previewFrame.iframeKey])

  useEffect(() => {
    reportedRuntimeErrorsRef.current.clear()
  }, [deckId, documentRevision])

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
  }, [])

  useEffect(() => {
    if (isPresentOpen || pendingPresentExitIndexRef.current === null) {
      return
    }

    const finalIndex = pendingPresentExitIndexRef.current
    pendingPresentExitIndexRef.current = null
    navigation.goToSlide(finalIndex)
  }, [isPresentOpen, navigation.goToSlide])

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
  }, [openPresentMode, presentHandleRef])

  return {
    analysis,
    chrome: {
      bridgeEnabled,
      editChromeActive,
      isPresentOpen,
      previewCompromised,
      previewCompromiseReason: bridgeSession.compromiseReason,
      previewEnabled,
    },
    frame: {
      iframeRef,
      previewFrame,
      previewFrameScale,
      previewStageRef,
      previewViewportRef,
      previewViewportSize,
    },
    navigation,
    present: {
      handlePresentViewportSizeChange,
      openPresentMode,
      pendingPresentExitIndexRef,
      setIsPresentOpen,
    },
    refs: { activeSlideIndexRef, clearSelectionRef, textEditActiveRef },
    runtimeError: { notice: runtimeError, setNotice: setRuntimeError },
    session: bridgeSession,
    source,
  }
}
