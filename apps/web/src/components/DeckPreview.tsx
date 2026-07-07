import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
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

import { EditModeToolbar, PreviewEditModeToggle } from '@/components/EditModeToolbar'
import { EditorSelectionOverlay } from '@/components/EditorSelectionOverlay'
import { PresentMode } from '@/components/PresentMode'
import { SlideThumbnailStrip } from '@/components/SlideThumbnailStrip'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeckPreviewFrame } from '@/hooks/useDeckPreviewFrame'
import { useDeckEditorBridge } from '@/hooks/useDeckEditorBridge'
import { useDeckSlideNavigation } from '@/hooks/useDeckSlideNavigation'
import { useElementSize } from '@/hooks/useElementSize'
import {
  getPreviewFrameScale,
  getPreviewFrameStyle,
  getPreviewSandbox,
  getPreviewStageStyle,
} from '@/lib/deck-preview'
import { parseDeckSlides } from '@/lib/deck-slides'
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
import { previewStripsDeckScripts } from '@/lib/deck-export'
import { buildDeckRuntimeManifestInBrowser } from '@/lib/deck-runtime-manifest'
import { validateDeckHtmlInBrowser } from '../lib/deck-validate.ts'
import { reportRuntimeError } from '@/lib/runtime-error-api'
import { cn } from '@/lib/utils'
import type { EditorTool } from '@ark/deck-core/deck-editor-bridge.ts'
import { isRemoteImageUrl } from '@ark/deck-core/deck-image.ts'
import type { ImageFitMode } from '@ark/deck-core/deck-image.ts'

export type DeckTextEditCommit = {
  elementId: string
  slideIndex: number
  slideId: string | null
  text: string
  originalText: string | null
}

export type DeckPreviewProps = {
  html: string
  deckId?: string | null
  versionId?: string | null
  isGenerating: boolean
  isStripOpen: boolean
  layout: 'desktop' | 'mobile'
  parsedDeck: ReturnType<typeof parseDeckSlides>
  editorBridgeEnabled?: boolean
  isTextEditSaving?: boolean
  canUndo?: boolean
  canRedo?: boolean
  undoSlideIndex?: number | null
  redoSlideIndex?: number | null
  onUndo?: () => void | Promise<void>
  onRedo?: () => void | Promise<void>
  onCommitTextEdit?: (commit: DeckTextEditCommit) => Promise<void>
  onPatchEditorOperations?: (
    operations: import('@ark/deck-core/deck-patch.ts').DeckElementPatchOperation[],
    activeSlideIndex: number,
    summary: string,
  ) => Promise<void>
}

export function DeckPreview({
  html,
  deckId = null,
  versionId = null,
  isGenerating,
  isStripOpen,
  layout,
  parsedDeck,
  editorBridgeEnabled = false,
  isTextEditSaving = false,
  canUndo = false,
  canRedo = false,
  undoSlideIndex = null,
  redoSlideIndex = null,
  onUndo,
  onRedo,
  onCommitTextEdit,
  onPatchEditorOperations,
}: DeckPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previewStageRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [previewViewportRef, previewViewportSize] = useElementSize<HTMLDivElement>()
  const [isPresentOpen, setIsPresentOpen] = useState(false)
  const [editModeActive, setEditModeActive] = useState(false)
  const [activeTool, setActiveTool] = useState<EditorTool>('select')
  const [imageFitOverride, setImageFitOverride] = useState<{
    elementId: string
    fit: ImageFitMode
  } | null>(null)
  const pendingPresentExitIndexRef = useRef<number | null>(null)
  const preserveSlideIndexRef = useRef<number | null>(null)
  const processedTextCommitRef = useRef<string | null>(null)
  const processedInsertRequestRef = useRef<string | null>(null)
  const processedDeleteRequestRef = useRef<string | null>(null)
  const processedTransformCommitRef = useRef<string | null>(null)
  const committedGeometryRef = useRef<
    import('@ark/deck-core/deck-editor-bridge.ts').EditorNormalizedRect | null
  >(null)
  const transformStartGeometryRef = useRef<
    import('@ark/deck-core/deck-editor-bridge.ts').EditorNormalizedRect | null
  >(null)
  const isTransformingRef = useRef(false)
  const runtimeManifest = useMemo(() => buildDeckRuntimeManifestInBrowser(html), [html])
  const runtimeMode = runtimeManifest.runtimeMode
  const validation = useMemo(() => validateDeckHtmlInBrowser(html), [html])
  const usesStaticPreview = useMemo(
    () => previewStripsDeckScripts(html, runtimeManifest),
    [html, runtimeManifest],
  )
  const manifestWarnings = runtimeManifest.warnings
  const networkIssues = validation.issues.filter(
    (issue) => issue.code === 'external_url' && issue.severity === 'error',
  )
  const hasSlides = parsedDeck.slideCount > 0
  const editChromeActive = editModeActive && !isGenerating
  const editorBridgeInjected = editorBridgeEnabled && editChromeActive
  const previewFrame = useDeckPreviewFrame(html, html.length > 0 && hasSlides && !isPresentOpen, {
    editorBridge: editorBridgeInjected,
  })
  const reportedRuntimeErrorsRef = useRef(new Set<string>())
  const activeSlideIndexRef = useRef(0)
  const textEditActiveRef = useRef(false)
  const { activeSlideIndex, goToSlide } = useDeckSlideNavigation(
    iframeRef,
    parsedDeck.slideCount,
    html,
    html.length > 0 && hasSlides && !isPresentOpen,
    {
      runtimeMode,
      keyboardMode: isPresentOpen ? 'off' : 'preview',
      shouldSuspendKeyboard: () => textEditActiveRef.current,
      sandboxOrigin: previewFrame.sandboxOrigin,
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

  useEffect(() => {
    activeSlideIndexRef.current = activeSlideIndex
  }, [activeSlideIndex])

  const {
    editorReady,
    selection,
    hover,
    geometry,
    hoverGeometry,
    editorError,
    lastTextCommit,
    lastInsertRequest,
    lastDeleteRequest,
    transformPreview,
    transformCommit,
    textEditActive,
    enableEditor,
    disableEditor,
    requestGeometry,
    startTextEdit,
    cancelTextEdit,
    setTool,
  } = useDeckEditorBridge(iframeRef, {
    enabled: editorBridgeInjected && html.length > 0 && hasSlides && !isPresentOpen,
    activeSlideIndex,
    sandboxOrigin: previewFrame.sandboxOrigin,
    iframeGenerationKey: previewFrame.iframeKey,
  })

  useEffect(() => {
    textEditActiveRef.current = textEditActive
  }, [textEditActive])

  const canEditSelectedText = useMemo(
    () => editChromeActive && isTextEditableSelection(selection),
    [editChromeActive, selection],
  )

  const canModifySelection =
    Boolean(selection?.managed) && !selection?.locked && editChromeActive && !textEditActive

  const selectedImage = Boolean(
    selection &&
    !selection.locked &&
    selection.managed &&
    (selection.editableKind === 'image' || selection.tagName === 'img'),
  )

  const selectedImageAlt = selectedImage ? (selection?.textPreview ?? '') : ''

  const selectedImageFit: ImageFitMode =
    selectedImage &&
    imageFitOverride !== null &&
    imageFitOverride.elementId === selection?.elementId
      ? imageFitOverride.fit
      : (selection?.imageFit ?? 'contain')

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

  const handleDuplicateSelection = useCallback(() => {
    if (!selection || !canModifySelection || !onPatchEditorOperations) {
      return
    }

    void onPatchEditorOperations(
      [
        {
          op: 'duplicate_element',
          elementId: selection.elementId,
          slideIndex: selection.slideIndex,
          ...(selection.slideId ? { slideId: selection.slideId } : {}),
        },
      ],
      selection.slideIndex,
      'Duplicated element in preview',
    )
  }, [canModifySelection, onPatchEditorOperations, selection])

  const handleReorderSelection = useCallback(
    (direction: 'front' | 'back') => {
      if (!selection || !canModifySelection || !onPatchEditorOperations) {
        return
      }

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
    [canModifySelection, onPatchEditorOperations, selection],
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
    if (isTransformingRef.current) {
      return
    }

    committedGeometryRef.current = geometry
  }, [geometry])

  // A transform preview marks the start of a drag/resize. Snapshot the pre-drag
  // geometry on the first preview frame and freeze the baseline until commit.
  useEffect(() => {
    if (!transformPreview || isTransformingRef.current) {
      return
    }

    isTransformingRef.current = true
    transformStartGeometryRef.current = committedGeometryRef.current
  }, [transformPreview])

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

  const exitEditMode = useCallback(() => {
    endTextEditing()
    disableEditor()
    setActiveTool('select')
    setImageFitOverride(null)
    setEditModeActive(false)
  }, [disableEditor, endTextEditing])

  const handleEditModeChange = useCallback(
    (nextActive: boolean) => {
      if (!nextActive) {
        exitEditMode()
        return
      }

      if (!(html.length > 0 && hasSlides && !isGenerating)) {
        return
      }

      setEditModeActive(true)
    },
    [exitEditMode, hasSlides, html.length, isGenerating],
  )

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
    [onPatchEditorOperations, selectedImage, selection],
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
    [onPatchEditorOperations, selectedImage, selection],
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

    void onCommitTextEdit({
      elementId: lastTextCommit.elementId,
      slideIndex: lastTextCommit.slideIndex,
      slideId: lastTextCommit.slideId,
      text: lastTextCommit.text,
      originalText: lastTextCommit.originalText,
    }).catch(() => {
      processedTextCommitRef.current = null
      preserveSlideIndexRef.current = null
    })
  }, [activeSlideIndex, lastTextCommit, onCommitTextEdit])

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

    const commitKey = `${transformCommit.elementId}:${transformCommit.slideIndex}:${transformCommit.geometry.x}:${transformCommit.geometry.y}:${transformCommit.geometry.width}:${transformCommit.geometry.height}`

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

    void onPatchEditorOperations(
      operations,
      transformCommit.slideIndex,
      'Updated element layout in preview',
    ).catch(() => {
      processedTransformCommitRef.current = null
      preserveSlideIndexRef.current = null
    })
  }, [activeSlideIndex, onPatchEditorOperations, selection?.slideId, transformCommit])

  useEffect(() => {
    if (preserveSlideIndexRef.current === null) {
      return
    }

    const slideIndex = preserveSlideIndexRef.current
    preserveSlideIndexRef.current = null
    goToSlide(slideIndex)
  }, [goToSlide, html, previewFrame.iframeKey])

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
    if (!editModeActive || !isGenerating) {
      return
    }

    endTextEditing()
    disableEditor()
  }, [disableEditor, editModeActive, endTextEditing, isGenerating])

  useEffect(() => {
    if (!editorBridgeInjected || !editorReady) {
      return
    }

    enableEditor(activeSlideIndex, activeTool)
  }, [
    activeSlideIndex,
    activeTool,
    editorBridgeInjected,
    editorReady,
    enableEditor,
    previewFrame.iframeKey,
  ])

  useEffect(() => {
    if (!editChromeActive || !selection?.elementId) {
      return
    }

    requestGeometry(selection.elementId, selection.slideIndex)
  }, [editChromeActive, requestGeometry, selection])

  useEffect(() => {
    if (!editChromeActive || !hover?.elementId) {
      return
    }

    if (hover.elementId === selection?.elementId) {
      return
    }

    requestGeometry(hover.elementId, hover.slideIndex)
  }, [editChromeActive, hover, requestGeometry, selection?.elementId])

  useEffect(() => {
    if (isPresentOpen || pendingPresentExitIndexRef.current === null) {
      return
    }

    const finalIndex = pendingPresentExitIndexRef.current
    pendingPresentExitIndexRef.current = null
    goToSlide(finalIndex)
  }, [goToSlide, isPresentOpen])

  const previewFrameScale = getPreviewFrameScale(previewViewportSize)
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
          {editorBridgeEnabled ? (
            <PreviewEditModeToggle
              active={editModeActive}
              disabled={!canPresent || isPresentOpen}
              onChange={handleEditModeChange}
            />
          ) : (
            <span className="truncate text-xs font-medium">Preview</span>
          )}
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
            onClick={() => setIsPresentOpen(true)}
            type="button"
          >
            <Maximize2Icon className="size-3" />
            Present
          </button>
          {isTextEditSaving ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ark-titlebar-muted)]">
              <Loader2Icon className="size-3 animate-spin" />
              Saving edit
            </span>
          ) : null}
          {runtimeMode === 'custom-js' ? (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
              Scripts running
            </span>
          ) : runtimeMode === 'reveal' && !usesStaticPreview ? (
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-violet-700 dark:text-violet-300">
              Reveal runtime
            </span>
          ) : usesStaticPreview ? (
            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-300">
              Static preview
            </span>
          ) : null}
          <span className="flex items-center gap-1">
            <FileCode2Icon className="size-3" />
            {previewFrame.usesSandboxHost ? 'Sandbox host' : 'srcDoc'}
          </span>
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
            id="ark-slide-strip"
            isOpen={isStripOpen}
            key={html}
            onSelect={goToSlide}
            orientation={stripOrientation}
            parsedDeck={parsedDeck}
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
            ref={previewViewportRef}
          >
            {html ? (
              <div
                className="relative max-h-full max-w-full overflow-hidden bg-white shadow-2xl shadow-slate-950/10 ring-1 ring-[var(--ark-stage-border)]"
                ref={previewStageRef}
                style={previewStageStyle}
              >
                <iframe
                  className="absolute left-0 top-0 block border-0 bg-white"
                  key={previewFrame.iframeKey}
                  onLoad={() => {
                    if (editorBridgeInjected) {
                      enableEditor(activeSlideIndex, activeTool)
                    }
                  }}
                  ref={iframeRef}
                  referrerPolicy="no-referrer"
                  sandbox={getPreviewSandbox(runtimeMode)}
                  src={previewFrame.iframeSrc}
                  srcDoc={previewFrame.iframeSrcDoc}
                  style={previewFrameStyle}
                  title="Generated Ark presentation preview"
                />
                {previewFrame.error ? (
                  <div className="absolute inset-x-4 top-4 rounded-lg border border-red-500/30 bg-red-50/95 px-3 py-2 text-xs text-red-900 shadow-sm backdrop-blur dark:bg-red-950/90 dark:text-red-100">
                    <p className="font-medium">Sandbox preview unavailable</p>
                    <p>{previewFrame.error}</p>
                  </div>
                ) : null}
                {previewFrame.isLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-medium text-muted-foreground backdrop-blur-sm">
                    Loading sandbox preview…
                  </div>
                ) : null}
                {editChromeActive ? (
                  <EditorSelectionOverlay
                    geometry={geometry}
                    hoverGeometry={hoverGeometry}
                    isEditing={textEditActive}
                    locked={selection?.locked ?? false}
                    scale={previewFrameScale}
                  />
                ) : null}
                {usesStaticPreview ? (
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
                {editorError ? (
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
                {networkIssues.length > 0 ? (
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
                {manifestWarnings.length > 0 && !usesStaticPreview && networkIssues.length === 0 ? (
                  <div className="absolute inset-x-4 top-4 rounded-lg border border-amber-500/30 bg-amber-50/95 px-3 py-2 text-xs text-amber-950 shadow-sm backdrop-blur dark:bg-amber-950/90 dark:text-amber-100">
                    <div className="flex items-start gap-2">
                      <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="font-medium">Runtime notice</p>
                        <p>{manifestWarnings[0]}</p>
                      </div>
                    </div>
                  </div>
                ) : null}
                {isGenerating ? (
                  <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full border bg-white/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur">
                    <Loader2Icon className="size-3.5 animate-spin" />
                    Updating preview
                  </div>
                ) : null}
              </div>
            ) : isGenerating ? (
              <PreviewSkeleton scale={previewFrameScale} />
            ) : (
              <EmptyPreview />
            )}
          </div>
        </div>
      </div>

      {isPresentOpen ? (
        <PresentMode
          html={html}
          initialSlideIndex={activeSlideIndex}
          onExit={(finalIndex) => {
            pendingPresentExitIndexRef.current = finalIndex
            setIsPresentOpen(false)
          }}
          runtimeMode={runtimeMode}
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
