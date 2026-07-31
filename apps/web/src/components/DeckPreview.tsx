import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MutableRefObject,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { WandSparklesIcon } from 'lucide-react'

import { EditModeToolbar } from '@/components/EditModeToolbar'
import { EditorSelectionOverlay } from '@/components/EditorSelectionOverlay'
import { DeckPreviewStatusOverlays } from '@/components/DeckPreviewStatusOverlays'
import { PresentMode } from '@/components/PresentMode'
import { SelectionInspectorChrome } from '@/components/SelectionInspectorChrome'
import { SlideThumbnailStrip } from '@/components/SlideThumbnailStrip'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { useDeckPreviewFrame } from '@/hooks/useDeckPreviewFrame'
import { useDeckEditorBridge } from '@/hooks/useDeckEditorBridge'
import { useDeckSlideNavigation } from '@/hooks/useDeckSlideNavigation'
import {
  usePreviewBridgeSession,
  type PreviewBridgeCompromiseReason,
} from '@/hooks/usePreviewBridgeSession'
import { useDeckThumbnails } from '@/hooks/useDeckThumbnails'
import { useElementSize } from '@/hooks/useElementSize'
import { useDeckPreviewSource, type DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import { useDeckEditorShellShortcuts } from '@/hooks/useDeckEditorShellShortcuts'
import {
  useDeckEditorPatchCoordinator,
  type DeckTextEditCommit,
} from '@/hooks/useDeckEditorPatchCoordinator'
import {
  getPreviewFrameScale,
  getPreviewFrameStyle,
  getPreviewSandbox,
  getPreviewStageStyle,
  PREVIEW_IFRAME_SECURITY_PROPS,
} from '@/lib/deck-preview'
import type { DeckBrowserAnalysis } from '@/lib/deck-analysis'
import { clientPointToNormalizedSlidePoint } from '@/lib/deck-image-insert'
import { reportRuntimeError } from '@/lib/runtime-error-api'
import { cn } from '@/lib/utils'
import type { EditorSelectionInfo, EditorTool } from '@ark/deck-core/deck-editor-bridge.ts'
import type { DeckSlidePatch } from '@ark/deck-core/deck-slide-patch.ts'

export type { DeckTextEditCommit } from '@/hooks/useDeckEditorPatchCoordinator'

const MAX_RUNTIME_ERROR_REPORTS_PER_DECK_VERSION = 20
const MAX_RUNTIME_ERROR_MESSAGE_LENGTH = 2_000
const MAX_RUNTIME_ERROR_SOURCE_LENGTH = 500
const MAX_RUNTIME_ERROR_SUMMARY_LENGTH = 500

type RuntimeErrorNotice = {
  deckId: string | null
  message: string
  slideIndex: number
  versionId: string | null
}

export type DeckPreviewHandle = {
  openPresent: () => void
}

export type DeckPreviewProps = {
  html: string
  deckId?: string | null
  versionId?: string | null
  recentGenerationJobId?: string | null
  isGenerating: boolean
  isPreviewUpdating?: boolean
  isStripOpen: boolean
  layout: 'desktop' | 'mobile'
  deckAnalysis: DeckBrowserAnalysis
  /** When set, preview/edit bars render into this host so they can span the full shell width. */
  chromeHost?: HTMLElement | null
  editorBridgeEnabled?: boolean
  isTextEditSaving?: boolean
  initialSlideIndex?: number
  canUndo?: boolean
  canRedo?: boolean
  undoSlideIndex?: number | null
  redoSlideIndex?: number | null
  /** Zero-based slide indexes currently attached as chat context. */
  contextSlideIndexes?: number[]
  /** Ref filled with the bridge clear-selection function for chat context chips. */
  clearEditorSelectionRef?: MutableRefObject<(() => boolean) | null>
  onUndo?: () => void | Promise<void>
  onRedo?: () => void | Promise<void>
  onCommitTextEdit?: (commit: DeckTextEditCommit) => Promise<DeckPreviewPatchResult | undefined>
  /** Reports the current editor selection to the shell (issue #83); null when edit chrome is inactive. */
  onEditorSelectionChange?: (selection: EditorSelectionInfo | null) => void
  /** Toggle a slide as chat context without changing the active slide. */
  onToggleContextSlide?: (index: number) => void
  onReorderSlide?: (
    fromIndex: number,
    toIndex: number,
    activeSlideIndex: number,
  ) => Promise<DeckPreviewPatchResult | undefined>
  onPatchEditorOperations?: (
    operations: import('@ark/deck-core/deck-patch.ts').DeckElementPatchOperation[],
    activeSlideIndex: number,
    summary: string,
  ) => Promise<DeckPreviewPatchResult | undefined>
  /** Imperative present-mode handle for the title bar (prop, not forwardRef). */
  presentHandleRef?: RefObject<DeckPreviewHandle | null>
}

export function DeckPreview({
  html,
  deckId = null,
  versionId = null,
  recentGenerationJobId = null,
  isGenerating,
  isPreviewUpdating = false,
  isStripOpen,
  layout,
  deckAnalysis,
  chromeHost = null,
  editorBridgeEnabled = false,
  isTextEditSaving = false,
  initialSlideIndex = 0,
  canUndo = false,
  canRedo = false,
  undoSlideIndex = null,
  redoSlideIndex = null,
  contextSlideIndexes,
  clearEditorSelectionRef,
  onUndo,
  onRedo,
  onCommitTextEdit,
  onEditorSelectionChange,
  onToggleContextSlide,
  onReorderSlide,
  onPatchEditorOperations,
  presentHandleRef,
}: DeckPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previewStageRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [previewViewportRef, previewViewportSize] = useElementSize<HTMLDivElement>()
  const [isPresentOpen, setIsPresentOpen] = useState(false)
  const [presentViewportSize, setPresentViewportSize] = useState(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }))
  const [activeTool, setActiveTool] = useState<EditorTool>('select')
  const effectivePreviewViewportSize =
    isPresentOpen && presentViewportSize.width > 0 && presentViewportSize.height > 0
      ? presentViewportSize
      : previewViewportSize
  const previewFrameScale = getPreviewFrameScale(effectivePreviewViewportSize)
  const pendingPresentExitIndexRef = useRef<number | null>(null)
  const wasEditChromeActiveRef = useRef(false)
  const parsedDeck = deckAnalysis
  const runtimeManifest = deckAnalysis.runtimeManifest
  const runtimeMode = runtimeManifest.runtimeMode
  const validation = deckAnalysis.validation
  const usesStaticPreview = deckAnalysis.usesStaticPreview
  const networkIssues = validation.issues.filter(
    (issue) => issue.code === 'external_url' && issue.severity === 'error',
  )
  const hasSlides = parsedDeck.slideCount > 0
  const previewEnabled = html.length > 0 && hasSlides
  const editChromeActive = previewEnabled && !isGenerating && !isPresentOpen
  const editorBridgeActive = editorBridgeEnabled && editChromeActive
  // Slide patching runs from useDeckPreviewSource's layout effect, before the
  // frame/bridge hooks below exist for this render — go through refs holding
  // last committed state so a patch is only sent to a settled, armed frame.
  const dispatchSlidePatchRef = useRef<((patch: DeckSlidePatch) => boolean) | null>(null)
  const canPatchSlidesRef = useRef(false)
  const clearSelectionRef = useRef<(() => boolean) | null>(null)
  const dispatchSlidePatch = useCallback((patch: DeckSlidePatch) => {
    if (!canPatchSlidesRef.current || !dispatchSlidePatchRef.current?.(patch)) {
      return false
    }

    // Replaced slides detach the selected node; the shell reloads today, so
    // dropping the selection matches what an agent edit already does.
    clearSelectionRef.current?.()
    return true
  }, [])
  const {
    previewHtml,
    previewReloadRevision,
    previewContentRevision,
    beginLivePatch: beginLivePreviewPatch,
    finishLivePatch: finishPreviewSourcePatch,
    rollbackLivePatch: reloadCanonicalPreview,
  } = useDeckPreviewSource(deckId, html, { onSlidePatch: dispatchSlidePatch })
  const previewFrame = useDeckPreviewFrame(previewHtml, previewEnabled, previewReloadRevision)
  const reportedRuntimeErrorsRef = useRef(new Set<string>())
  const activeSlideIndexRef = useRef(0)
  const textEditActiveRef = useRef(false)
  const [runtimeError, setRuntimeError] = useState<RuntimeErrorNotice | null>(null)
  const captureRuntimeError = useCallback(
    (rawMessage: string, rawSource?: string | null, showNotice = true) => {
      const message = rawMessage.trim().slice(0, MAX_RUNTIME_ERROR_MESSAGE_LENGTH)

      if (!message) {
        return
      }

      const source = rawSource?.trim().slice(0, MAX_RUNTIME_ERROR_SOURCE_LENGTH) || null
      const fingerprint = `${message.slice(0, MAX_RUNTIME_ERROR_SUMMARY_LENGTH)}:${source ?? ''}`
      const isNavigationGuard = source === 'preview-navigation-guard'

      if (
        reportedRuntimeErrorsRef.current.has(fingerprint) ||
        (!isNavigationGuard &&
          reportedRuntimeErrorsRef.current.size >= MAX_RUNTIME_ERROR_REPORTS_PER_DECK_VERSION)
      ) {
        return
      }

      reportedRuntimeErrorsRef.current.add(fingerprint)
      const slideIndex = activeSlideIndexRef.current

      if (showNotice) {
        setRuntimeError({
          deckId,
          message,
          slideIndex,
          versionId,
        })
      }

      void reportRuntimeError({
        deckId,
        versionId,
        slideIndex,
        runtimeMode,
        severity: 'error',
        message,
        source,
        repairContext: {
          errorSummary: message.slice(0, MAX_RUNTIME_ERROR_SUMMARY_LENGTH),
          affectedSlideIndex: slideIndex,
          runtime: {
            mode: runtimeMode,
            previewMode: runtimeManifest.previewMode,
            approvedRuntime: runtimeManifest.approvedRuntime ?? null,
          },
          validation: {
            status: validation.valid ? 'valid' : 'invalid',
            errors: runtimeManifest.validation.errors,
            warnings: runtimeManifest.validation.warnings,
          },
          relatedJobId: recentGenerationJobId,
          versionId,
        },
      }).catch(() => {
        reportedRuntimeErrorsRef.current.delete(fingerprint)
      })
    },
    [
      deckId,
      recentGenerationJobId,
      runtimeManifest.approvedRuntime,
      runtimeManifest.previewMode,
      runtimeManifest.validation.errors,
      runtimeManifest.validation.warnings,
      runtimeMode,
      validation.valid,
      versionId,
    ],
  )
  const reportNavigationCompromise = useCallback(
    (reason: PreviewBridgeCompromiseReason) => {
      const message =
        reason === 'unexpected-load'
          ? 'Preview stopped: the deck attempted an unexpected navigation away from the sandbox render URL.'
          : reason === 'invalid-handshake'
            ? 'Preview stopped: the preview frame sent an invalid security handshake.'
            : 'Preview stopped: the preview frame never completed its security handshake with Ark.'

      captureRuntimeError(message, 'preview-navigation-guard', false)
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
  const previewCompromiseReason = bridgeSession.compromiseReason
  const bridgeEnabled = previewEnabled && !previewCompromised

  // Keep secondary preview work off the critical path until the current main
  // frame has loaded and completed its handshake. In particular, a thumbnail
  // long-poll can occupy an HTTP/1.1 connection for five seconds and fallback
  // iframes compete with the main frame for parse/layout time.
  const mainPreviewReady =
    previewCompromised ||
    Boolean(previewFrame.error) ||
    (bridgeSession.armed && !previewFrame.isLoading && !previewFrame.isStale)
  const { activeSlideIndex, goToSlide, patchSlides } = useDeckSlideNavigation(
    iframeRef,
    parsedDeck.slideCount,
    previewHtml,
    bridgeEnabled,
    {
      runtimeMode,
      initialSlideIndex,
      keyboardMode: previewCompromised ? 'off' : isPresentOpen ? 'present' : 'preview',
      shouldSuspendKeyboard: () => textEditActiveRef.current,
      sandboxOrigin: previewFrame.sandboxOrigin,
      reloadRevision: previewReloadRevision,
      syncOnLoad: false,
      canPostToFrame: bridgeSession.canPostToFrame,
      shouldAcceptInbound: bridgeSession.shouldAcceptInbound,
      onRuntimeError: captureRuntimeError,
      onSlidePatchFailed: reloadCanonicalPreview,
    },
  )
  const handleReorderSlide = useCallback(
    async (fromIndex: number, toIndex: number) => {
      const result = await onReorderSlide?.(fromIndex, toIndex, activeSlideIndex)
      const suggestedIndex = result?.patch.suggestedActiveSlideIndex

      if (typeof suggestedIndex === 'number') {
        goToSlide(suggestedIndex)
      }

      return result
    },
    [activeSlideIndex, goToSlide, onReorderSlide],
  )

  useLayoutEffect(() => {
    dispatchSlidePatchRef.current = patchSlides
    canPatchSlidesRef.current =
      previewEnabled &&
      bridgeEnabled &&
      bridgeSession.armed &&
      !previewFrame.isLoading &&
      !previewFrame.isStale &&
      // An in-flight text edit owns a live contenteditable node; leave that
      // case on the reload path the editor coordinator already handles.
      !textEditActiveRef.current
  })
  const { thumbnailUrls } = useDeckThumbnails(deckId, versionId, parsedDeck.slideCount, {
    // Always-on edit chrome stays active while previewing; only wait for the
    // main frame so thumbnail polling does not compete with first paint.
    enabled: mainPreviewReady,
  })
  // Defer strip updates so rapid undo/redo does not remount every thumbnail iframe
  // while the main preview is still settling (manual-edit smoke / CDP context lookup).
  // Never defer the initial empty→slides transition: a deferred empty parse leaves the
  // strip unmounted while the slide counter is already visible, and benchmarks/tooling
  // that toggle the strip can accidentally collapse it before it appears.
  const deferredParsedDeck = useDeferredValue(parsedDeck)
  const stripParsedDeck =
    deferredParsedDeck.slideCount === 0 && parsedDeck.slideCount > 0
      ? parsedDeck
      : deferredParsedDeck
  const deferredThumbnailUrls = useDeferredValue(thumbnailUrls)

  useEffect(() => {
    activeSlideIndexRef.current = activeSlideIndex
  }, [activeSlideIndex])

  const {
    editorReady,
    selection,
    hover,
    geometry,
    slideBounds,
    hoverGeometry,
    hoverSlideBounds,
    selectionZIndex,
    editorError,
    lastTextCommit,
    lastInsertRequest,
    lastDeleteRequest,
    lastShortcutRequest,
    transformPreview,
    transformCommit,
    transformCancelSequence,
    textEditActive,
    enableEditor,
    configureEditor,
    disableEditor,
    selectElement,
    clearSelection,
    requestGeometry,
    startTextEdit,
    cancelTextEdit,
    setTool,
    assignElementId,
  } = useDeckEditorBridge(iframeRef, {
    enabled: editorBridgeActive && bridgeEnabled,
    activeSlideIndex,
    sandboxOrigin: previewFrame.sandboxOrigin,
    iframeGenerationKey: previewFrame.iframeKey,
    sessionHandshake: previewFrame.handshake,
    canPostToFrame: bridgeSession.canPostToFrame,
    shouldAcceptInbound: bridgeSession.shouldAcceptInbound,
  })

  useEffect(() => {
    // Allow re-reporting if the shell remounts the preview after a prior compromise.
    for (const fingerprint of reportedRuntimeErrorsRef.current) {
      if (fingerprint.endsWith(':preview-navigation-guard')) {
        reportedRuntimeErrorsRef.current.delete(fingerprint)
      }
    }
  }, [previewFrame.iframeKey])

  useEffect(() => {
    reportedRuntimeErrorsRef.current.clear()
  }, [deckId, versionId])

  useEffect(() => {
    if (!bridgeSession.armed || previewCompromised) {
      return
    }

    goToSlide(activeSlideIndexRef.current)

    if (editorBridgeActive) {
      enableEditor(activeSlideIndexRef.current, activeTool, previewFrameScale || undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tool/scale are initial enable payloads; their dedicated messages own later updates
  }, [
    bridgeSession.armed,
    editorBridgeActive,
    enableEditor,
    goToSlide,
    previewCompromised,
    previewFrame.iframeKey,
  ])

  useEffect(() => {
    textEditActiveRef.current = textEditActive
  }, [textEditActive])

  useLayoutEffect(() => {
    clearSelectionRef.current = clearSelection
  }, [clearSelection])

  const handleToolChange = useCallback(
    (tool: EditorTool) => {
      setActiveTool(tool)
      setTool(tool)
    },
    [setTool],
  )

  const {
    canEditSelectedText,
    handleDeleteSelection,
    handleDuplicateSelection,
    handleImageAltChange,
    handleImageFitChange,
    handleInsertImageFile,
    handleInspectorApply,
    handleRedo,
    handleReorderSelection,
    handleUndo,
    selectedImage,
    selectedImageAlt,
    selectedImageFit,
  } = useDeckEditorPatchCoordinator({
    activeSlideIndex,
    canRedo,
    canUndo,
    editChromeActive,
    editorReady,
    geometry,
    iframeKey: previewFrame.iframeKey,
    isTextEditSaving,
    lastDeleteRequest,
    lastInsertRequest,
    lastShortcutRequest,
    lastTextCommit,
    onCommitTextEdit,
    onPatchEditorOperations,
    onRedo,
    onSelectElement: selectElement,
    onSelectTool: handleToolChange,
    onUndo,
    preserveRedoSlideIndex: redoSlideIndex,
    preserveUndoSlideIndex: undoSlideIndex,
    previewContentRevision,
    selection,
    scopeKey: deckId,
    textEditActive,
    transformCancelSequence,
    transformCommit,
    transformPreview,
    beginLivePatch: beginLivePreviewPatch,
    finishLivePatch: finishPreviewSourcePatch,
    goToSlide,
    rollbackLivePatch: reloadCanonicalPreview,
    onAssignElementId: assignElementId,
  })

  const beginTextEdit = useCallback(() => {
    if (!selection || !canEditSelectedText || textEditActive) {
      return
    }

    startTextEdit(selection.elementId, selection.slideIndex)
  }, [canEditSelectedText, selection, startTextEdit, textEditActive])

  const endTextEditing = useCallback(() => {
    if (!textEditActive) {
      return
    }

    cancelTextEdit()
  }, [cancelTextEdit, textEditActive])

  useEffect(() => {
    const wasEditChromeActive = wasEditChromeActiveRef.current
    wasEditChromeActiveRef.current = editChromeActive

    if (!wasEditChromeActive || editChromeActive) {
      return
    }

    endTextEditing()
    disableEditor()
  }, [disableEditor, editChromeActive, endTextEditing])

  const openImagePicker = useCallback(() => {
    imageInputRef.current?.click()
  }, [])

  const handleImageInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''

      if (!file) {
        handleToolChange('select')
        return
      }

      void handleInsertImageFile(file)
    },
    [handleInsertImageFile, handleToolChange],
  )

  useDeckEditorShellShortcuts({
    active: editChromeActive,
    textEditActive,
    isTextEditSaving,
    activeTool,
    canEditSelectedText,
    canUndo,
    canRedo,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onEndTextEditing: endTextEditing,
    onSelectTool: () => handleToolChange('select'),
    onBeginTextEdit: beginTextEdit,
    onInsertImage: (file) => void handleInsertImageFile(file),
  })

  useEffect(() => {
    if (!editorBridgeActive || !editorReady) {
      return
    }

    // Tool changes are pushed via setTool; re-enable only when the slide or
    // iframe generation changes so we do not clear pending insert/transform
    // requests on every toolbar click.
    enableEditor(activeSlideIndex, activeTool, previewFrameScale || undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tool/scale are initial enable payloads; their dedicated messages own later updates
  }, [activeSlideIndex, editorBridgeActive, editorReady, enableEditor, previewFrame.iframeKey])

  useEffect(() => {
    if (editorBridgeActive && editorReady && previewFrameScale > 0) {
      configureEditor(previewFrameScale)
    }
  }, [configureEditor, editorBridgeActive, editorReady, previewFrameScale])

  useEffect(() => {
    if (!editChromeActive || !selection?.elementId) {
      return
    }

    requestGeometry(selection.elementId, selection.slideIndex)
    // Re-measure when the preview viewport resizes so letterboxed slides keep
    // the parent overlay aligned after scale changes.
  }, [
    editChromeActive,
    previewViewportSize.height,
    previewViewportSize.width,
    requestGeometry,
    selection,
  ])

  // Mirror the live selection up to the shell so chat requests can target the
  // selected element. Report null whenever the edit chrome is inactive (edit
  // mode off, generating, or presenting) so a stale id is never sent.
  useEffect(() => {
    if (!onEditorSelectionChange) {
      return
    }

    onEditorSelectionChange(editChromeActive ? selection : null)
  }, [editChromeActive, onEditorSelectionChange, selection])

  useEffect(() => {
    if (!clearEditorSelectionRef) {
      return
    }

    // Only expose clear while the editor bridge can actually clear selection.
    // When inactive, leave the ref null so App falls back to local state clear.
    if (editorBridgeActive && bridgeEnabled) {
      clearEditorSelectionRef.current = clearSelection
    } else {
      clearEditorSelectionRef.current = null
    }

    return () => {
      clearEditorSelectionRef.current = null
    }
  }, [bridgeEnabled, clearEditorSelectionRef, clearSelection, editorBridgeActive])

  useEffect(() => {
    if (isPresentOpen || pendingPresentExitIndexRef.current === null) {
      return
    }

    const finalIndex = pendingPresentExitIndexRef.current
    pendingPresentExitIndexRef.current = null
    goToSlide(finalIndex)
  }, [goToSlide, isPresentOpen])

  const handlePresentViewportSizeChange = useCallback((size: { width: number; height: number }) => {
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
    if (!presentHandleRef) {
      return
    }

    presentHandleRef.current = { openPresent: openPresentMode }
    return () => {
      presentHandleRef.current = null
    }
  }, [openPresentMode, presentHandleRef])
  const previewStageStyle = getPreviewStageStyle(previewFrameScale)
  const previewFrameStyle = getPreviewFrameStyle(previewFrameScale)
  const hasStrip = hasSlides
  const stripOrientation = layout === 'desktop' ? 'vertical' : 'horizontal'
  const previewChrome =
    editorBridgeEnabled && editChromeActive ? (
      <EditModeToolbar
        activeTool={activeTool}
        canEditText={canEditSelectedText}
        canRedo={canRedo}
        canUndo={canUndo}
        hasDeck={html.length > 0 && hasSlides}
        hasSelection={Boolean(selection?.elementId)}
        imageAlt={selectedImageAlt}
        imageFit={selectedImageFit}
        isGenerating={isGenerating}
        isSaving={isTextEditSaving}
        onBringForward={() => handleReorderSelection('front')}
        onDelete={handleDeleteSelection}
        onDuplicate={handleDuplicateSelection}
        onEditText={beginTextEdit}
        onImageAltChange={handleImageAltChange}
        onImageFitChange={handleImageFitChange}
        onPickImage={openImagePicker}
        onRedo={handleRedo}
        onSendBackward={() => handleReorderSelection('back')}
        onToolChange={handleToolChange}
        onUndo={handleUndo}
        selectedImage={selectedImage}
        selectionLocked={selection?.locked ?? false}
        selectionManaged={selection?.managed ?? false}
        textEditActive={textEditActive}
      />
    ) : null

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--ark-stage)]">
      {chromeHost ? createPortal(previewChrome, chromeHost) : previewChrome}

      <input
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleImageInputChange}
        ref={imageInputRef}
        type="file"
      />

      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden',
          layout === 'desktop' ? 'flex flex-row' : 'flex flex-col',
        )}
      >
        {hasStrip ? (
          <SlideThumbnailStrip
            activeIndex={activeSlideIndex}
            contentEnabled={mainPreviewReady}
            contextSlideIndexes={contextSlideIndexes}
            id="ark-slide-strip"
            isOpen={isStripOpen}
            onReorder={
              onReorderSlide && editChromeActive && !isPreviewUpdating && !isTextEditSaving
                ? handleReorderSlide
                : undefined
            }
            onSelect={goToSlide}
            onToggleContextSlide={onToggleContextSlide}
            orientation={stripOrientation}
            parsedDeck={stripParsedDeck}
            thumbnailUrls={deferredThumbnailUrls}
          />
        ) : null}

        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden p-4 lg:p-6"
            onDragOver={(event) => {
              if (!editChromeActive || textEditActive) {
                return
              }

              if ([...event.dataTransfer.types].includes('Files')) {
                event.preventDefault()
              }
            }}
            onDrop={(event) => {
              if (!editChromeActive || textEditActive) {
                return
              }

              const file = event.dataTransfer.files[0]

              if (!file?.type.startsWith('image/')) {
                return
              }

              event.preventDefault()
              const position = clientPointToNormalizedSlidePoint(
                event.clientX,
                event.clientY,
                previewStageRef.current,
              )
              void handleInsertImageFile(file, position)
            }}
            onPointerDown={(event) => {
              if (!editChromeActive || textEditActive || !selection) {
                return
              }

              // Clicks on the letterbox / stage chrome (not the iframe) clear the
              // selection the same way empty-slide clicks do inside the deck.
              if (
                event.target === previewViewportRef.current ||
                event.target === previewStageRef.current
              ) {
                clearSelection()
              }
            }}
            ref={previewViewportRef}
          >
            {html ? (
              <div
                className={cn(
                  'relative max-h-full max-w-full overflow-hidden bg-white shadow-[0_8px_28px_var(--ark-stage-shadow)]',
                  isPresentOpen &&
                    'fixed left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2',
                )}
                ref={previewStageRef}
                style={previewStageStyle}
              >
                {previewCompromised ||
                (!previewFrame.iframeSrc && !previewFrame.iframeSrcDoc) ? null : (
                  <iframe
                    className="absolute left-0 top-0 block border-0 bg-white"
                    key={previewFrame.iframeKey}
                    onLoad={() => {
                      const decision = bridgeSession.onFrameLoad()

                      if (!decision.allowDownstream) {
                        return
                      }

                      goToSlide(activeSlideIndexRef.current)

                      if (editorBridgeActive) {
                        enableEditor(
                          activeSlideIndexRef.current,
                          activeTool,
                          previewFrameScale || undefined,
                        )
                      }
                    }}
                    ref={iframeRef}
                    referrerPolicy="no-referrer"
                    sandbox={getPreviewSandbox(runtimeMode)}
                    src={previewFrame.iframeSrc}
                    srcDoc={previewFrame.iframeSrcDoc}
                    style={previewFrameStyle}
                    title="Generated Ark presentation preview"
                    {...PREVIEW_IFRAME_SECURITY_PROPS}
                  />
                )}
                {editChromeActive ? (
                  <EditorSelectionOverlay
                    geometry={selection ? geometry : null}
                    hoverGeometry={hover?.elementId === selection?.elementId ? null : hoverGeometry}
                    hoverSlideBounds={hoverSlideBounds}
                    hoverSurface={hover?.surface}
                    isEditing={textEditActive}
                    locked={selection?.locked ?? false}
                    scale={previewFrameScale}
                    slideBounds={slideBounds}
                    surface={selection?.surface}
                  />
                ) : null}
                {editorBridgeEnabled && editChromeActive ? (
                  <SelectionInspectorChrome
                    geometry={transformPreview?.geometry ?? geometry}
                    isSaving={isTextEditSaving}
                    onApplyOperations={onPatchEditorOperations ? handleInspectorApply : undefined}
                    scale={previewFrameScale}
                    selection={selection}
                    slideBounds={transformPreview?.slideBounds ?? slideBounds}
                    textEditActive={textEditActive}
                    transforming={Boolean(transformPreview)}
                    zIndex={selectionZIndex}
                  />
                ) : null}
                <DeckPreviewStatusOverlays
                  compromised={previewCompromised}
                  compromiseReason={previewCompromiseReason}
                  editorError={editorError}
                  frameError={previewFrame.error}
                  isLoading={previewFrame.isLoading}
                  isPresentOpen={isPresentOpen}
                  isPreviewUpdating={isPreviewUpdating}
                  networkIssue={networkIssues[0]?.message}
                  onDismissRuntimeError={() => setRuntimeError(null)}
                  runtimeError={
                    runtimeError?.deckId === deckId && runtimeError.versionId === versionId
                      ? runtimeError
                      : null
                  }
                  usesStaticPreview={usesStaticPreview}
                />
              </div>
            ) : (
              <EmptyPreview isGenerating={isGenerating} isPreviewUpdating={isPreviewUpdating} />
            )}
          </div>
        </div>
      </div>

      {isPresentOpen ? (
        <PresentMode
          activeSlideIndex={activeSlideIndex}
          onExit={(finalIndex) => {
            pendingPresentExitIndexRef.current = finalIndex
            setIsPresentOpen(false)
          }}
          onGoToSlide={goToSlide}
          onViewportSizeChange={handlePresentViewportSizeChange}
          previewCompromised={previewCompromised}
          previewCompromiseReason={previewCompromiseReason}
          slideCount={parsedDeck.slideCount}
        />
      ) : null}
    </section>
  )
}

function EmptyPreview({
  isGenerating = false,
  isPreviewUpdating = false,
}: {
  isGenerating?: boolean
  isPreviewUpdating?: boolean
}) {
  const busy = isGenerating || isPreviewUpdating

  return (
    <Empty className="max-w-xl">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WandSparklesIcon />
        </EmptyMedia>
        <EmptyTitle>Set the stage</EmptyTitle>
        <EmptyDescription>
          {busy
            ? 'The agent is building your deck. Progress shows in the chat panel.'
            : 'Ask the agent to build a deck, or upload a self-contained HTML presentation from the command strip.'}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {busy ? (
          <span className="text-xs text-muted-foreground" role="status">
            {isPreviewUpdating ? 'Updating preview…' : 'Building your deck…'}
          </span>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">
            Try: “Create a six-slide launch deck for a privacy-first notes app.”
          </span>
        )}
      </EmptyContent>
    </Empty>
  )
}
