import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import {
  FileCode2Icon,
  Loader2Icon,
  Maximize2Icon,
  MonitorPlayIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  WandSparklesIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { EditModeToolbar } from '@/components/EditModeToolbar'
import { EditorSelectionOverlay } from '@/components/EditorSelectionOverlay'
import { PresentMode } from '@/components/PresentMode'
import { SelectionInspectorChrome } from '@/components/SelectionInspectorChrome'
import { SlideThumbnailStrip } from '@/components/SlideThumbnailStrip'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeckPreviewFrame } from '@/hooks/useDeckPreviewFrame'
import { useDeckEditorBridge } from '@/hooks/useDeckEditorBridge'
import { useDeckSlideNavigation } from '@/hooks/useDeckSlideNavigation'
import { usePreviewBridgeSession } from '@/hooks/usePreviewBridgeSession'
import { useDeckThumbnails } from '@/hooks/useDeckThumbnails'
import { useElementSize } from '@/hooks/useElementSize'
import {
  getPreviewFrameScale,
  getPreviewFrameStyle,
  getPreviewSandbox,
  getPreviewStageStyle,
  PREVIEW_IFRAME_SECURITY_PROPS,
} from '@/lib/deck-preview'
import type { DeckBrowserAnalysis } from '@/lib/deck-analysis'
import {
  buildTextBoxInsertOperation,
  buildTransformPatchOperations,
} from '@/lib/deck-editor-patches'
import {
  buildImageInsertOperation,
  clientPointToNormalizedSlidePoint,
  isEditableClipboardTarget,
  prepareImageInsertFromFile,
} from '@/lib/deck-image-insert'
import { isTextEditableSelection } from '@/lib/deck-text-edit'
import type { DeckElementPatchOperation } from '@ark/deck-core/deck-patch.ts'
import { reportRuntimeError } from '@/lib/runtime-error-api'
import { cn } from '@/lib/utils'
import type { EditorSelectionInfo, EditorTool } from '@ark/deck-core/deck-editor-bridge.ts'
import { isRemoteImageUrl } from '@ark/deck-core/deck-image.ts'
import type { ImageFitMode } from '@ark/deck-core/deck-image.ts'
import { TRANSIENT_ELEMENT_ID_PREFIX } from '@ark/deck-core/deck-metadata.ts'
import type { PatchDeckResponse } from '@/lib/deck-api'

export type DeckTextEditCommit = {
  elementId: string
  slideIndex: number
  slideId: string | null
  text: string
  originalText: string | null
}

type DeckPreviewPatchResult = Pick<PatchDeckResponse, 'patch'> & {
  deck?: Pick<PatchDeckResponse['deck'], 'html'>
}

export type DeckPreviewProps = {
  html: string
  deckId?: string | null
  versionId?: string | null
  isGenerating: boolean
  isPreviewUpdating?: boolean
  isStripOpen: boolean
  layout: 'desktop' | 'mobile'
  deckAnalysis: DeckBrowserAnalysis
  editorBridgeEnabled?: boolean
  isTextEditSaving?: boolean
  canUndo?: boolean
  canRedo?: boolean
  undoSlideIndex?: number | null
  redoSlideIndex?: number | null
  onUndo?: () => void | Promise<void>
  onRedo?: () => void | Promise<void>
  onCommitTextEdit?: (commit: DeckTextEditCommit) => Promise<DeckPreviewPatchResult | undefined>
  /** Reports the current editor selection to the shell (issue #83); null when edit chrome is inactive. */
  onEditorSelectionChange?: (selection: EditorSelectionInfo | null) => void
  onPatchEditorOperations?: (
    operations: import('@ark/deck-core/deck-patch.ts').DeckElementPatchOperation[],
    activeSlideIndex: number,
    summary: string,
  ) => Promise<DeckPreviewPatchResult | undefined>
}

export function DeckPreview({
  html,
  deckId = null,
  versionId = null,
  isGenerating,
  isPreviewUpdating = false,
  isStripOpen,
  layout,
  deckAnalysis,
  editorBridgeEnabled = false,
  isTextEditSaving = false,
  canUndo = false,
  canRedo = false,
  undoSlideIndex = null,
  redoSlideIndex = null,
  onUndo,
  onRedo,
  onCommitTextEdit,
  onEditorSelectionChange,
  onPatchEditorOperations,
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
  const [previewSource, setPreviewSource] = useState(() => ({
    deckId,
    html,
    reloadRevision: 0,
  }))
  const [imageFitOverride, setImageFitOverride] = useState<{
    elementId: string
    fit: ImageFitMode
  } | null>(null)
  const effectivePreviewViewportSize =
    isPresentOpen && presentViewportSize.width > 0 && presentViewportSize.height > 0
      ? presentViewportSize
      : previewViewportSize
  const previewFrameScale = getPreviewFrameScale(effectivePreviewViewportSize)
  const pendingPresentExitIndexRef = useRef<number | null>(null)
  const preserveSlideIndexRef = useRef<number | null>(null)
  const pendingReselectRef = useRef<{
    elementId: string
    slideIndex: number
    iframeKey: string
  } | null>(null)
  const processedTextCommitRef = useRef<string | null>(null)
  const processedInsertRequestRef = useRef<string | null>(null)
  const processedDeleteRequestRef = useRef<string | null>(null)
  const processedShortcutRequestRef = useRef<string | null>(null)
  const processedTransformCommitRef = useRef<string | null>(null)
  const pendingTransformPatchRef = useRef<Promise<DeckPreviewPatchResult | undefined> | null>(null)
  const canonicalPreviewSourceRef = useRef({ deckId, html })
  const observedPreviewSourceRef = useRef({ deckId, html })
  const livePreviewPatchPendingRef = useRef(false)
  const expectedLivePreviewHtmlRef = useRef<string | null>(null)
  const committedGeometryRef = useRef<
    import('@ark/deck-core/deck-editor-bridge.ts').EditorNormalizedRect | null
  >(null)
  const transformStartGeometryRef = useRef<
    import('@ark/deck-core/deck-editor-bridge.ts').EditorNormalizedRect | null
  >(null)
  const isTransformingRef = useRef(false)
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
  const previewSourceMatchesDeck = previewSource.deckId === deckId
  const previewHtml = previewSourceMatchesDeck ? previewSource.html : html
  const previewReloadRevision = previewSource.reloadRevision + (previewSourceMatchesDeck ? 0 : 1)
  const previewFrame = useDeckPreviewFrame(previewHtml, previewEnabled, previewReloadRevision)
  const reportedRuntimeErrorsRef = useRef(new Set<string>())
  const activeSlideIndexRef = useRef(0)
  const textEditActiveRef = useRef(false)
  const reportNavigationCompromise = useCallback(() => {
    const fingerprint = 'unexpected-frame-navigation:preview-navigation-guard'

    if (reportedRuntimeErrorsRef.current.has(fingerprint)) {
      return
    }

    reportedRuntimeErrorsRef.current.add(fingerprint)

    void reportRuntimeError({
      deckId,
      versionId,
      slideIndex: activeSlideIndexRef.current,
      runtimeMode,
      severity: 'error',
      message:
        'Preview stopped: the deck attempted an unexpected navigation away from the sandbox render URL.',
      source: 'preview-navigation-guard',
    }).catch(() => {
      reportedRuntimeErrorsRef.current.delete(fingerprint)
    })
  }, [deckId, runtimeMode, versionId])
  const bridgeSession = usePreviewBridgeSession(previewFrame.iframeKey, {
    enabled: previewEnabled && Boolean(previewFrame.handshake?.trim()),
    handshake: previewFrame.handshake,
    sandboxOrigin: previewFrame.sandboxOrigin,
    onCompromised: reportNavigationCompromise,
  })
  const previewCompromised = bridgeSession.compromised
  const bridgeEnabled = previewEnabled && !previewCompromised

  useLayoutEffect(() => {
    canonicalPreviewSourceRef.current = { deckId, html }
    const observed = observedPreviewSourceRef.current

    if (observed.deckId !== deckId) {
      observedPreviewSourceRef.current = { deckId, html }
      livePreviewPatchPendingRef.current = false
      expectedLivePreviewHtmlRef.current = null
      setPreviewSource((current) => ({
        deckId,
        html,
        reloadRevision: current.reloadRevision + 1,
      }))
      return
    }

    if (observed.html === html) {
      return
    }

    observedPreviewSourceRef.current = { deckId, html }

    if (livePreviewPatchPendingRef.current || expectedLivePreviewHtmlRef.current === html) {
      if (expectedLivePreviewHtmlRef.current === html) {
        expectedLivePreviewHtmlRef.current = null
      }
      return
    }

    setPreviewSource((current) => ({
      ...current,
      deckId,
      html,
      reloadRevision: current.html === html ? current.reloadRevision + 1 : current.reloadRevision,
    }))
  }, [deckId, html])

  const beginLivePreviewPatch = useCallback((elementId: string) => {
    if (elementId.startsWith(TRANSIENT_ELEMENT_ID_PREFIX) || livePreviewPatchPendingRef.current) {
      return false
    }

    livePreviewPatchPendingRef.current = true
    expectedLivePreviewHtmlRef.current = null
    return true
  }, [])

  const reloadCanonicalPreview = useCallback(() => {
    const canonical = canonicalPreviewSourceRef.current

    livePreviewPatchPendingRef.current = false
    expectedLivePreviewHtmlRef.current = null
    observedPreviewSourceRef.current = canonical
    setPreviewSource((current) => ({
      deckId: canonical.deckId,
      html: canonical.html,
      reloadRevision: current.reloadRevision + 1,
    }))
  }, [])

  const finishLivePreviewPatch = useCallback(
    (result: DeckPreviewPatchResult | undefined) => {
      livePreviewPatchPendingRef.current = false

      if (!result) {
        reloadCanonicalPreview()
        return
      }

      const resultHtml = result.deck?.html
      const observed = observedPreviewSourceRef.current

      if (resultHtml && (observed.deckId !== deckId || observed.html !== resultHtml)) {
        expectedLivePreviewHtmlRef.current = resultHtml
      } else {
        expectedLivePreviewHtmlRef.current = null
      }

      preserveSlideIndexRef.current = null
      pendingReselectRef.current = null
    },
    [deckId, reloadCanonicalPreview],
  )
  // Keep secondary preview work off the critical path until the current main
  // frame has loaded and completed its handshake. In particular, a thumbnail
  // long-poll can occupy an HTTP/1.1 connection for five seconds and fallback
  // iframes compete with the main frame for parse/layout time.
  const mainPreviewReady =
    previewCompromised ||
    Boolean(previewFrame.error) ||
    (bridgeSession.armed && !previewFrame.isLoading && !previewFrame.isStale)
  const { activeSlideIndex, goToSlide } = useDeckSlideNavigation(
    iframeRef,
    parsedDeck.slideCount,
    previewHtml,
    bridgeEnabled,
    {
      runtimeMode,
      keyboardMode: previewCompromised ? 'off' : isPresentOpen ? 'present' : 'preview',
      shouldSuspendKeyboard: () => textEditActiveRef.current,
      sandboxOrigin: previewFrame.sandboxOrigin,
      syncOnLoad: false,
      canPostToFrame: bridgeSession.canPostToFrame,
      shouldAcceptInbound: bridgeSession.shouldAcceptInbound,
      onRuntimeError: (message, source) => {
        const fingerprint = `${message}:${source ?? ''}`

        if (reportedRuntimeErrorsRef.current.has(fingerprint)) {
          return
        }

        reportedRuntimeErrorsRef.current.add(fingerprint)

        void reportRuntimeError({
          deckId,
          versionId,
          slideIndex: activeSlideIndexRef.current,
          runtimeMode,
          severity: 'error',
          message,
          source: source ?? null,
        }).catch(() => {
          reportedRuntimeErrorsRef.current.delete(fingerprint)
        })
      },
    },
  )
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
    reportedRuntimeErrorsRef.current.delete('unexpected-frame-navigation:preview-navigation-guard')
  }, [previewFrame.iframeKey])

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

  const canEditSelectedText = useMemo(
    () => editChromeActive && isTextEditableSelection(selection),
    [editChromeActive, selection],
  )

  const canModifySelection =
    selection !== null && !selection.locked && editChromeActive && !textEditActive

  const selectedImage = Boolean(
    selection &&
    !selection.locked &&
    (selection.editableKind === 'image' || selection.tagName === 'img'),
  )

  const selectedImageAlt = selectedImage ? (selection?.textPreview ?? '') : ''

  const selectedImageFit: ImageFitMode =
    selectedImage &&
    imageFitOverride !== null &&
    imageFitOverride.elementId === selection?.elementId
      ? imageFitOverride.fit
      : (selection?.imageFit ?? 'contain')

  // Remember the current selection so it can be restored after the preview
  // iframe reloads with the patched HTML (issue #84). The recorded iframeKey
  // marks the pre-patch frame; the reselect effect waits for a new frame.
  const scheduleReselect = useCallback(() => {
    if (!selection?.elementId) {
      return
    }

    pendingReselectRef.current = {
      elementId: selection.elementId,
      slideIndex: selection.slideIndex,
      iframeKey: previewFrame.iframeKey,
    }
  }, [previewFrame.iframeKey, selection])

  const handleInspectorApply = useCallback(
    (operations: DeckElementPatchOperation[], summary: string) => {
      if (!selection || !onPatchEditorOperations || operations.length === 0) {
        return
      }

      preserveSlideIndexRef.current = selection.slideIndex
      scheduleReselect()

      void onPatchEditorOperations(operations, selection.slideIndex, summary).catch(() => {
        pendingReselectRef.current = null
        preserveSlideIndexRef.current = null
      })
    },
    [onPatchEditorOperations, scheduleReselect, selection],
  )

  const handleDeleteSelection = useCallback(() => {
    if (!selection || !canModifySelection || !onPatchEditorOperations) {
      return
    }

    void onPatchEditorOperations(
      [
        {
          op: 'delete_element',
          elementId: selection.elementId,
          slideIndex: selection.slideIndex,
          ...(selection.slideId ? { slideId: selection.slideId } : {}),
        },
      ],
      selection.slideIndex,
      'Deleted element in preview',
    )
  }, [canModifySelection, onPatchEditorOperations, selection])

  const duplicateElement = useCallback(
    (elementId: string, slideIndex: number, slideId: string | null) =>
      onPatchEditorOperations?.(
        [
          {
            op: 'duplicate_element',
            elementId,
            slideIndex,
            ...(slideId ? { slideId } : {}),
          },
        ],
        slideIndex,
        'Duplicated element in preview',
      ),
    [onPatchEditorOperations],
  )

  const handleDuplicateSelection = useCallback(() => {
    if (
      !selection ||
      selection.locked ||
      !editChromeActive ||
      textEditActive ||
      !onPatchEditorOperations
    ) {
      return
    }

    void duplicateElement(selection.elementId, selection.slideIndex, selection.slideId)
  }, [duplicateElement, editChromeActive, onPatchEditorOperations, selection, textEditActive])

  const handleReorderSelection = useCallback(
    (direction: 'front' | 'back') => {
      if (!selection || !selection.managed || !canModifySelection || !onPatchEditorOperations) {
        return
      }

      scheduleReselect()

      void onPatchEditorOperations(
        [
          {
            op: 'reorder_element',
            elementId: selection.elementId,
            slideIndex: selection.slideIndex,
            ...(selection.slideId ? { slideId: selection.slideId } : {}),
            direction,
          },
        ],
        selection.slideIndex,
        direction === 'front' ? 'Brought element forward' : 'Sent element backward',
      )
    },
    [canModifySelection, onPatchEditorOperations, scheduleReselect, selection],
  )

  const handleUndo = useCallback(() => {
    if (!canUndo || !onUndo || textEditActive || isTextEditSaving) {
      return
    }

    // Jump to the slide the reverted edit happened on so the change is visible;
    // fall back to the current slide when it is unknown.
    preserveSlideIndexRef.current = undoSlideIndex ?? activeSlideIndex
    void onUndo()
  }, [activeSlideIndex, canUndo, isTextEditSaving, onUndo, textEditActive, undoSlideIndex])

  const handleRedo = useCallback(() => {
    if (!canRedo || !onRedo || textEditActive || isTextEditSaving) {
      return
    }

    preserveSlideIndexRef.current = redoSlideIndex ?? activeSlideIndex
    void onRedo()
  }, [activeSlideIndex, canRedo, isTextEditSaving, onRedo, redoSlideIndex, textEditActive])

  // Track the element's geometry from *before* a transform begins so a commit can
  // be diffed against the real starting rect. While a drag is in progress the
  // runtime streams `ark:editor-geometry` on every preview frame, so we must stop
  // syncing here — otherwise the baseline would drift to the live previewed rect
  // and the commit diff would come back empty (element visibly moves but nothing
  // persists).
  useEffect(() => {
    if (isTransformingRef.current || transformPreview) {
      return
    }

    committedGeometryRef.current = geometry
  }, [geometry, transformPreview])

  // A transform preview marks the start of a drag/resize. Snapshot the pre-drag
  // geometry on the first preview frame and freeze the baseline until commit.
  useEffect(() => {
    if (!transformPreview || isTransformingRef.current) {
      return
    }

    isTransformingRef.current = true
    transformStartGeometryRef.current = committedGeometryRef.current
  }, [transformPreview])

  useEffect(() => {
    if (transformCancelSequence === 0) {
      return
    }

    isTransformingRef.current = false
    transformStartGeometryRef.current = null
  }, [transformCancelSequence])

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

  const handleToolChange = useCallback(
    (tool: EditorTool) => {
      setActiveTool(tool)
      setTool(tool)
    },
    [setTool],
  )

  const openImagePicker = useCallback(() => {
    imageInputRef.current?.click()
  }, [])

  const handleInsertImageFile = useCallback(
    async (file: File, position?: { x: number; y: number }) => {
      if (!onPatchEditorOperations) {
        toast.error('Save the deck before inserting images')
        return
      }

      try {
        const prepared = await prepareImageInsertFromFile(file, position)
        preserveSlideIndexRef.current = activeSlideIndex

        await onPatchEditorOperations(
          [buildImageInsertOperation(activeSlideIndex, prepared, null)],
          activeSlideIndex,
          'Inserted image in preview',
        )
        handleToolChange('select')
      } catch (insertError) {
        toast.error(
          insertError instanceof Error ? insertError.message : 'Could not insert the image',
        )
      }
    },
    [activeSlideIndex, handleToolChange, onPatchEditorOperations],
  )

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

  const handleImageAltChange = useCallback(
    (alt: string) => {
      if (!selection || !selectedImage || !onPatchEditorOperations) {
        return
      }

      scheduleReselect()

      void onPatchEditorOperations(
        [
          {
            op: 'set_attrs',
            elementId: selection.elementId,
            slideIndex: selection.slideIndex,
            ...(selection.slideId ? { slideId: selection.slideId } : {}),
            attrs: { alt },
          },
        ],
        selection.slideIndex,
        'Updated image alt text',
      )
    },
    [onPatchEditorOperations, scheduleReselect, selectedImage, selection],
  )

  const handleImageFitChange = useCallback(
    (fit: ImageFitMode) => {
      if (!selection || !selectedImage || !onPatchEditorOperations) {
        return
      }

      setImageFitOverride({
        elementId: selection.elementId,
        fit,
      })
      scheduleReselect()

      void onPatchEditorOperations(
        [
          {
            op: 'set_inline_style',
            elementId: selection.elementId,
            slideIndex: selection.slideIndex,
            ...(selection.slideId ? { slideId: selection.slideId } : {}),
            style: { 'object-fit': fit },
          },
          {
            op: 'set_attrs',
            elementId: selection.elementId,
            slideIndex: selection.slideIndex,
            ...(selection.slideId ? { slideId: selection.slideId } : {}),
            attrs: { 'data-ark-fit': fit },
          },
        ],
        selection.slideIndex,
        'Updated image fit mode',
      )
    },
    [onPatchEditorOperations, scheduleReselect, selectedImage, selection],
  )

  useEffect(() => {
    if (!lastTextCommit || !onCommitTextEdit) {
      return
    }

    const commitKey = `${lastTextCommit.elementId}:${lastTextCommit.slideIndex}:${lastTextCommit.originalText}:${lastTextCommit.text}`

    if (processedTextCommitRef.current === commitKey) {
      return
    }

    processedTextCommitRef.current = commitKey

    if (lastTextCommit.text === lastTextCommit.originalText) {
      return
    }

    preserveSlideIndexRef.current = activeSlideIndex
    scheduleReselect()

    const keepLivePreview = beginLivePreviewPatch(lastTextCommit.elementId)

    void onCommitTextEdit({
      elementId: lastTextCommit.elementId,
      slideIndex: lastTextCommit.slideIndex,
      slideId: lastTextCommit.slideId,
      text: lastTextCommit.text,
      originalText: lastTextCommit.originalText,
    })
      .then((result) => {
        if (keepLivePreview) {
          finishLivePreviewPatch(result)
        }
      })
      .catch(() => {
        processedTextCommitRef.current = null
        preserveSlideIndexRef.current = null
        pendingReselectRef.current = null

        if (keepLivePreview) {
          reloadCanonicalPreview()
        }
      })
  }, [
    activeSlideIndex,
    beginLivePreviewPatch,
    finishLivePreviewPatch,
    lastTextCommit,
    onCommitTextEdit,
    reloadCanonicalPreview,
    scheduleReselect,
  ])

  useEffect(() => {
    if (!lastInsertRequest || !onPatchEditorOperations) {
      return
    }

    const requestKey = `${lastInsertRequest.kind}:${lastInsertRequest.slideIndex}:${lastInsertRequest.geometry.x}:${lastInsertRequest.geometry.y}:${lastInsertRequest.geometry.width}:${lastInsertRequest.geometry.height}`

    if (processedInsertRequestRef.current === requestKey) {
      return
    }

    processedInsertRequestRef.current = requestKey
    preserveSlideIndexRef.current = activeSlideIndex

    void onPatchEditorOperations(
      [buildTextBoxInsertOperation(lastInsertRequest.slideIndex, lastInsertRequest.geometry, null)],
      lastInsertRequest.slideIndex,
      'Inserted text box in preview',
    )
      .then(() => {
        handleToolChange('select')
      })
      .catch(() => {
        processedInsertRequestRef.current = null
        preserveSlideIndexRef.current = null
      })
  }, [activeSlideIndex, handleToolChange, lastInsertRequest, onPatchEditorOperations])

  useEffect(() => {
    if (!lastDeleteRequest || !onPatchEditorOperations) {
      return
    }

    const requestKey = `${lastDeleteRequest.elementId}:${lastDeleteRequest.slideIndex}`

    if (processedDeleteRequestRef.current === requestKey) {
      return
    }

    processedDeleteRequestRef.current = requestKey
    preserveSlideIndexRef.current = activeSlideIndex

    void onPatchEditorOperations(
      [
        {
          op: 'delete_element',
          elementId: lastDeleteRequest.elementId,
          slideIndex: lastDeleteRequest.slideIndex,
        },
      ],
      lastDeleteRequest.slideIndex,
      'Deleted element in preview',
    ).catch(() => {
      processedDeleteRequestRef.current = null
      preserveSlideIndexRef.current = null
    })
  }, [activeSlideIndex, lastDeleteRequest, onPatchEditorOperations])

  useEffect(() => {
    if (!transformCommit || !onPatchEditorOperations) {
      return
    }

    const commitKey = `${transformCommit.elementId}:${transformCommit.slideIndex}:${transformCommit.geometry.x}:${transformCommit.geometry.y}:${transformCommit.geometry.width}:${transformCommit.geometry.height}:${transformCommit.adopted ? 'adopted' : 'managed'}`

    if (processedTransformCommitRef.current === commitKey) {
      return
    }

    // Diff against the geometry captured when the drag started, not the live
    // (previewed) geometry. Fall back to `null` when no drag baseline was
    // captured so the commit still persists move + resize.
    const previousGeometry = isTransformingRef.current ? transformStartGeometryRef.current : null

    const operations = buildTransformPatchOperations(
      transformCommit,
      previousGeometry,
      selection?.slideId ?? null,
    )

    isTransformingRef.current = false
    transformStartGeometryRef.current = null

    if (operations.length === 0) {
      return
    }

    processedTransformCommitRef.current = commitKey
    preserveSlideIndexRef.current = activeSlideIndex
    scheduleReselect()
    const keepLivePreview = beginLivePreviewPatch(transformCommit.elementId)

    const patchPromise = onPatchEditorOperations(
      operations,
      transformCommit.slideIndex,
      'Updated element layout in preview',
    )
    pendingTransformPatchRef.current = patchPromise

    void patchPromise
      .then((result) => {
        if (transformCommit.adopted) {
          const stableId = result?.patch.changedElementIds[0]
          const pending = pendingReselectRef.current

          if (stableId && pending?.elementId === transformCommit.elementId) {
            pending.elementId = stableId
          }
        }

        if (keepLivePreview) {
          finishLivePreviewPatch(result)
        }
      })
      .catch(() => {
        processedTransformCommitRef.current = null
        preserveSlideIndexRef.current = null
        pendingReselectRef.current = null

        if (keepLivePreview) {
          reloadCanonicalPreview()
        }
      })
      .finally(() => {
        if (pendingTransformPatchRef.current === patchPromise) {
          pendingTransformPatchRef.current = null
        }
      })
  }, [
    activeSlideIndex,
    beginLivePreviewPatch,
    finishLivePreviewPatch,
    onPatchEditorOperations,
    reloadCanonicalPreview,
    scheduleReselect,
    selection?.slideId,
    transformCommit,
  ])

  useEffect(() => {
    if (!lastShortcutRequest) {
      return
    }

    const requestKey = `${previewFrame.iframeKey}:${lastShortcutRequest.sequence}`

    if (processedShortcutRequestRef.current === requestKey) {
      return
    }

    processedShortcutRequestRef.current = requestKey

    if (lastShortcutRequest.action === 'duplicate') {
      if (
        !selection ||
        selection.locked ||
        !editChromeActive ||
        textEditActive ||
        !onPatchEditorOperations
      ) {
        return
      }

      const pendingTransform = pendingTransformPatchRef.current

      if (pendingTransform) {
        const { elementId, slideIndex, slideId } = selection
        void pendingTransform
          .then((result) =>
            duplicateElement(result?.patch.changedElementIds[0] ?? elementId, slideIndex, slideId),
          )
          .catch(() => undefined)
        return
      }

      if (transformPreview || isTextEditSaving) {
        return
      }

      if (transformCommit) {
        void duplicateElement(
          pendingReselectRef.current?.elementId ?? selection.elementId,
          selection.slideIndex,
          selection.slideId,
        )
        return
      }

      handleDuplicateSelection()
      return
    }

    if (transformPreview || pendingTransformPatchRef.current || isTextEditSaving) {
      return
    }

    if (lastShortcutRequest.action === 'undo') {
      handleUndo()
    } else {
      handleRedo()
    }
  }, [
    duplicateElement,
    editChromeActive,
    handleDuplicateSelection,
    handleRedo,
    handleUndo,
    isTextEditSaving,
    lastShortcutRequest,
    onPatchEditorOperations,
    previewFrame.iframeKey,
    selection,
    textEditActive,
    transformCommit,
    transformPreview,
  ])

  useEffect(() => {
    if (preserveSlideIndexRef.current === null) {
      return
    }

    const slideIndex = preserveSlideIndexRef.current
    preserveSlideIndexRef.current = null
    goToSlide(slideIndex)
  }, [goToSlide, previewFrame.iframeKey, previewHtml])

  useEffect(() => {
    if (!editChromeActive || textEditActive) {
      return
    }

    const handlePaste = (event: ClipboardEvent) => {
      if (isEditableClipboardTarget(event.target)) {
        return
      }

      const clipboard = event.clipboardData

      if (!clipboard) {
        return
      }

      for (const item of clipboard.items) {
        if (!item.type.startsWith('image/')) {
          continue
        }

        const file = item.getAsFile()

        if (!file) {
          continue
        }

        event.preventDefault()
        void handleInsertImageFile(file)
        return
      }

      const pastedText = clipboard.getData('text/plain').trim()

      if (pastedText && isRemoteImageUrl(pastedText)) {
        event.preventDefault()
        toast.error(
          'Remote image URLs cannot be inserted directly. Use a local file or paste image data.',
        )
      }
    }

    window.addEventListener('paste', handlePaste)

    return () => {
      window.removeEventListener('paste', handlePaste)
    }
  }, [editChromeActive, handleInsertImageFile, textEditActive])

  useEffect(() => {
    if (!editChromeActive) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const historyModifier = event.metaKey || event.ctrlKey

      if (historyModifier && !event.altKey && (event.key === 'z' || event.key === 'Z')) {
        // Leave undo/redo to the browser while editing text so contenteditable
        // history keeps working inside the deck.
        if (textEditActive || isTextEditSaving) {
          return
        }

        if (event.shiftKey) {
          if (!canRedo || !onRedo) {
            return
          }

          event.preventDefault()
          handleRedo()
        } else {
          if (!canUndo || !onUndo) {
            return
          }

          event.preventDefault()
          handleUndo()
        }

        return
      }

      if (
        historyModifier &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === 'y' || event.key === 'Y')
      ) {
        if (textEditActive || isTextEditSaving) {
          return
        }

        if (!canRedo || !onRedo) {
          return
        }

        event.preventDefault()
        handleRedo()
        return
      }

      if (event.key === 'Escape') {
        if (textEditActive) {
          event.preventDefault()
          endTextEditing()
          return
        }

        if (activeTool !== 'select') {
          event.preventDefault()
          handleToolChange('select')
        }

        return
      }

      if (
        event.key !== 'Enter' ||
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return
      }

      if (textEditActive || !canEditSelectedText) {
        return
      }

      if (event.target instanceof HTMLElement && event.target.closest('button, [role="button"]')) {
        return
      }

      event.preventDefault()
      beginTextEdit()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    activeTool,
    beginTextEdit,
    canEditSelectedText,
    canRedo,
    canUndo,
    editChromeActive,
    endTextEditing,
    handleRedo,
    handleToolChange,
    handleUndo,
    isTextEditSaving,
    onRedo,
    onUndo,
    textEditActive,
  ])

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

  // Restore the selection after the preview reloads with patched HTML so the
  // inspector stays populated across saves (issue #84). Waits for a *new*
  // iframe (key change) plus editor readiness, and gives up silently when the
  // element no longer exists or the user selected something else meanwhile.
  useEffect(() => {
    const pending = pendingReselectRef.current

    if (!pending) {
      return
    }

    if (!editChromeActive) {
      pendingReselectRef.current = null
      return
    }

    if (pending.iframeKey === previewFrame.iframeKey) {
      return
    }

    if (!editorReady || activeSlideIndex !== pending.slideIndex) {
      return
    }

    if (selection?.elementId) {
      pendingReselectRef.current = null
      return
    }

    pendingReselectRef.current = null
    selectElement(pending.elementId, pending.slideIndex)
  }, [
    activeSlideIndex,
    editChromeActive,
    editorReady,
    previewFrame.iframeKey,
    selectElement,
    selection?.elementId,
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
  const previewStageStyle = getPreviewStageStyle(previewFrameScale)
  const previewFrameStyle = getPreviewFrameStyle(previewFrameScale)
  const hasStrip = hasSlides
  const stripOrientation = layout === 'desktop' ? 'vertical' : 'horizontal'
  const canPresent = html.length > 0 && hasSlides && !isGenerating

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--ark-preview)]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)] px-3">
        <div className="flex min-w-0 items-center gap-2 text-[var(--ark-titlebar-fg)]">
          <MonitorPlayIcon
            aria-hidden
            className="size-3.5 shrink-0 text-[var(--ark-titlebar-muted)]"
          />
          <span className="truncate text-xs font-medium">Preview</span>
          <span aria-hidden className="text-[var(--ark-titlebar-muted)]">
            ›
          </span>
          <span className="truncate text-xs text-[var(--ark-titlebar-muted)]">
            {parsedDeck.slideCount > 0
              ? `Slide ${activeSlideIndex + 1} of ${parsedDeck.slideCount}`
              : 'HTML deck'}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--ark-titlebar-muted)]">
          <button
            aria-label="Present fullscreen"
            className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar-active)] px-2 text-[11px] font-medium text-[var(--ark-titlebar-fg)] transition-colors hover:bg-[var(--ark-titlebar-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canPresent || isPresentOpen}
            onClick={openPresentMode}
            type="button"
          >
            <Maximize2Icon className="size-3" />
            Present
          </button>
          {isTextEditSaving && !isPresentOpen ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ark-titlebar-muted)]">
              <Loader2Icon className="size-3 animate-spin" />
              Saving edit
            </span>
          ) : null}
          {!isPresentOpen && deckAnalysis.allowsDeckInitScripts ? (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
              Scripts running
            </span>
          ) : !isPresentOpen && runtimeMode === 'reveal' && !usesStaticPreview ? (
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-violet-700 dark:text-violet-300">
              Reveal runtime
            </span>
          ) : !isPresentOpen && usesStaticPreview ? (
            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-300">
              Static preview
            </span>
          ) : null}
          {!isPresentOpen ? (
            <span className="flex items-center gap-1">
              <FileCode2Icon className="size-3" />
              {previewFrame.usesSandboxHost ? 'Sandbox host' : 'srcDoc'}
            </span>
          ) : null}
        </span>
      </div>

      {editorBridgeEnabled && editChromeActive ? (
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
      ) : null}

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
            id="ark-slide-strip"
            isOpen={isStripOpen}
            onSelect={goToSlide}
            orientation={stripOrientation}
            parsedDeck={stripParsedDeck}
            thumbnailUrls={deferredThumbnailUrls}
          />
        ) : null}

        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden"
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
                  'relative max-h-full max-w-full overflow-hidden bg-white shadow-2xl shadow-slate-950/10 ring-1 ring-[var(--ark-stage-border)]',
                  isPresentOpen &&
                    'fixed left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 shadow-[0_40px_120px_rgba(0,0,0,0.65)] ring-white/10',
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
                {previewCompromised && !isPresentOpen ? (
                  <div className="absolute inset-x-4 top-4 z-10 rounded-lg border border-red-500/30 bg-red-50/95 px-3 py-2 text-xs text-red-900 shadow-sm backdrop-blur dark:bg-red-950/90 dark:text-red-100">
                    <div className="flex items-start gap-2">
                      <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="font-medium">Preview stopped</p>
                        <p>
                          The deck attempted an unexpected navigation. Preview was torn down to stop
                          further bridge messages from reaching an untrusted page. Edit or reload
                          the deck to restore the preview.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
                {!isPresentOpen && previewFrame.error ? (
                  <div className="absolute inset-x-4 top-4 rounded-lg border border-red-500/30 bg-red-50/95 px-3 py-2 text-xs text-red-900 shadow-sm backdrop-blur dark:bg-red-950/90 dark:text-red-100">
                    <p className="font-medium">Sandbox preview unavailable</p>
                    <p>{previewFrame.error}</p>
                  </div>
                ) : null}
                {!isPresentOpen && previewFrame.isLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-medium text-muted-foreground backdrop-blur-sm">
                    Loading sandbox preview…
                  </div>
                ) : null}
                {editChromeActive ? (
                  <EditorSelectionOverlay
                    geometry={selection ? geometry : null}
                    hoverGeometry={hoverGeometry}
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
                {!isPresentOpen && usesStaticPreview ? (
                  <div className="absolute inset-x-4 top-4 rounded-lg border border-sky-500/30 bg-sky-50/95 px-3 py-2 text-xs text-sky-950 shadow-sm backdrop-blur dark:bg-sky-950/90 dark:text-sky-100">
                    <div className="flex items-start gap-2">
                      <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="font-medium">Static preview</p>
                        <p>
                          Scripts and inline handlers were removed for preview. Download the
                          original HTML to keep executable code, or choose sanitized export to match
                          this preview.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
                {!isPresentOpen && editorError ? (
                  <div
                    className={cn(
                      'absolute inset-x-4 rounded-lg border border-red-500/30 bg-red-50/95 px-3 py-2 text-xs text-red-900 shadow-sm backdrop-blur dark:bg-red-950/90 dark:text-red-100',
                      usesStaticPreview ? 'top-24' : 'top-4',
                    )}
                  >
                    <p className="font-medium">Editor bridge error</p>
                    <p>{editorError}</p>
                  </div>
                ) : null}
                {!isPresentOpen && networkIssues.length > 0 ? (
                  <div
                    className={cn(
                      'absolute inset-x-4 rounded-lg border border-red-500/30 bg-red-50/95 px-3 py-2 text-xs text-red-900 shadow-sm backdrop-blur dark:bg-red-950/90 dark:text-red-100',
                      usesStaticPreview ? 'top-24' : 'top-4',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="font-medium">Network access blocked</p>
                        <p>{networkIssues[0]?.message}</p>
                      </div>
                    </div>
                  </div>
                ) : null}
                {!isPresentOpen && isPreviewUpdating ? (
                  <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full border bg-white/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur">
                    <Loader2Icon aria-hidden className="size-3.5 animate-spin" />
                    Updating preview
                  </div>
                ) : null}
              </div>
            ) : isGenerating || isPreviewUpdating ? (
              <PreviewSkeleton scale={previewFrameScale} />
            ) : (
              <EmptyPreview />
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
          slideCount={parsedDeck.slideCount}
        />
      ) : null}
    </section>
  )
}

function EmptyPreview() {
  return (
    <Card className="w-full max-w-xl border-dashed bg-white/80 text-center shadow-none">
      <CardHeader className="items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--ark-accent-soft)] text-[var(--ark-accent)]">
          <WandSparklesIcon className="size-6" />
        </div>
        <div className="flex flex-col gap-1">
          <CardTitle>Ready for your first deck</CardTitle>
          <CardDescription>
            Ask Ark for a pitch deck, strategy update, sales proposal, research summary, or any
            presentation you need.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-2xl border bg-[var(--ark-paper)] p-4 text-left text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Try:</p>
          <p>“Create a 6-slide launch deck for a privacy-first notes app.”</p>
        </div>
      </CardContent>
    </Card>
  )
}

function PreviewSkeleton({ scale }: { scale: number }) {
  return (
    <div
      className="max-h-full max-w-full bg-white p-8 shadow-2xl shadow-slate-950/10 ring-1 ring-[var(--ark-stage-border)]"
      style={getPreviewStageStyle(scale)}
    >
      <div className="flex h-full flex-col gap-8">
        <div className="flex items-center justify-between gap-8">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="grid flex-1 grid-cols-[1.2fr_0.8fr] gap-8">
          <div className="flex flex-col justify-center gap-4">
            <Skeleton className="h-10 w-4/5" />
            <Skeleton className="h-10 w-3/5" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="h-full rounded-2xl" />
        </div>
      </div>
    </div>
  )
}
