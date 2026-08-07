import { memo, useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'

import { type ChatAttachment } from '@ark/deck-core/chat.ts'
import { toast } from 'sonner'

import { AppTitleBar } from '@/components/AppTitleBar'
import { ChatContextChips } from '@/components/ChatContextChips'
import { ChatPanel } from '@/components/ChatPanel'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import { DeckPreview, type DeckPreviewHandle } from '@/components/DeckPreview'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAvailableModels } from '@/hooks/useAvailableModels'
import { useAppearance } from '@/hooks/useAppearance'
import { useReasoningEffort, type ReasoningEffort } from '@/hooks/useReasoningEffort'
import { useChatSession } from '@/hooks/useChatSession'
import { useDeckActions } from '@/hooks/useDeckActions'
import { useDeckEditHistory } from '@/hooks/useDeckEditHistory'
import { useDeckGenerationFlow } from '@/hooks/useDeckGenerationFlow'
import { useDeckPersistence } from '@/hooks/useDeckPersistence'
import { useElementSize } from '@/hooks/useElementSize'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import {
  CHAT_PANEL_MIN_WIDTH_PX,
  getChatPanelDefaultSize,
  getDeckPanelDefaultSizeWithChat,
} from '@/lib/chat-panel-layout'
import { analyzeDeckInBrowser } from '@/lib/deck-analysis'
import type { DeckElementPatchOperation, DeckPatchOperation } from '@ark/deck-core/deck-patch.ts'
import type { EditorSelectionInfo } from '@ark/deck-core/deck-editor-bridge.ts'
import { buildManualEditProvenance } from '@ark/deck-core/deck-edit-provenance.ts'
import {
  MAX_SLIDE_CONTEXTS,
  type ExternalDeckUpdate,
  type McpInteractionAnswer,
  type McpPendingInteraction,
} from '@ark/contracts'
import { toEditorSelectionContext } from '@/lib/editor-selection-context'
import {
  buildSlideContexts,
  extractSlideTitleFromOuterHtml,
  resolveContextSlides,
  sameContextSlideEntries,
  toggleContextSlideEntry,
  type ContextSlideEntry,
} from '@/lib/slide-context'
import type { PatchDeckResponse } from '@/lib/deck-api'
import { uploadDeckAsset } from '@/lib/asset-api'
import {
  startRevealThumbnailStylesPreload,
  waitForRevealThumbnailStylesPreload,
} from '@ark/runtime-registry/runtime-stylesheet-content.ts'
import { resolveAppOrigin } from '@ark/runtime-registry/sandbox-origin.ts'

/** Parse `?slide=` — 0-based index (slide=0 is the first slide). */
function parseInitialSlideIndex(value: string | null) {
  if (!value) {
    return 0
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

async function uploadPromptAttachments(
  deckId: string,
  files: PromptInputMessage['files'],
): Promise<ChatAttachment[]> {
  const attachments = new Array<ChatAttachment>(files.length)
  let nextIndex = 0

  async function uploadNext(): Promise<void> {
    const index = nextIndex
    nextIndex += 1
    const file = files[index]
    if (!file) return

    const input = {
      filename: file.filename ?? 'attachment',
      mediaType: file.mediaType,
      data: file.url,
    }
    const asset = await uploadDeckAsset(deckId, input)
    attachments[index] = {
      type: 'file',
      mediaType: asset.mediaType,
      filename: asset.filename,
      url: asset.url,
      assetId: asset.id,
    }
    await uploadNext()
  }

  const workerCount = Math.min(3, files.length)
  await Promise.all(Array.from({ length: workerCount }, uploadNext))
  return attachments
}

const MemoizedDeckPreview = memo(DeckPreview)

function App() {
  const navigate = useNavigate()
  const { deckId: routeParam } = useParams<{ deckId: string }>()
  const [searchParams] = useSearchParams()
  const routeDeckId = routeParam && routeParam !== 'new' ? routeParam : null
  const initialSlideIndex = parseInitialSlideIndex(searchParams.get('slide'))

  const {
    documentRevision,
    duplicate,
    filePath,
    hasDeck,
    html: generatedHtml,
    isLoading: isDeckLoading,
    isSaving: isDeckSaving,
    isPatching: isDeckPatching,
    deckId,
    deckTitle,
    deleteActiveDeck,
    patchDeckOperations,
    persistHtml,
    moveTo,
    openWorkspaceFile,
    refreshActiveDeck,
    renameActiveDeck,
    restoreHtmlSnapshot,
    saveAs,
    startNewDeck,
  } = useDeckPersistence(routeDeckId)

  // After the first save on /decks/new, put the real id in the URL.
  useEffect(() => {
    if (deckId && !routeDeckId) {
      navigate(`/decks/${deckId}`, { replace: true })
    }
  }, [deckId, navigate, routeDeckId])
  const editHistory = useDeckEditHistory()
  const {
    appendMessage,
    getMessageDeliveryStatus,
    messages,
    reloadChat,
    resetChat,
    retryPersist,
    setMessages,
  } = useChatSession({
    deckId,
    onPersistFailure: useCallback(() => {
      toast.error("Message couldn't be saved to the server — kept locally")
    }, []),
    onResetFailure: useCallback(() => {
      toast.error('Chat was cleared locally but may still exist on the server')
    }, []),
    onReloadFallback: useCallback(() => {
      toast.warning('Could not refresh chat from server — showing cached messages')
    }, []),
  })
  const [input, setInput] = useState('')
  const [mcpInteraction, setMcpInteraction] = useState<McpPendingInteraction | null>(null)
  const [editorSelection, setEditorSelection] = useState<EditorSelectionInfo | null>(null)
  const clearEditorSelectionRef = useRef<(() => boolean) | null>(null)
  const [contextSlideEntries, setContextSlideEntries] = useState<ContextSlideEntry[]>([])
  const [isChatOpen, setIsChatOpen] = useState(true)
  const [isStripOpen, setIsStripOpen] = useState(true)
  const deckPreviewRef = useRef<DeckPreviewHandle>(null)
  const [error, setError] = useState('')
  const [attachmentError, setAttachmentError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [thumbnailStylesRevision, setThumbnailStylesRevision] = useState(0)
  const [mainRef, mainSize] = useElementSize<HTMLElement>()
  const [deckChromeHost, setDeckChromeHost] = useState<HTMLDivElement | null>(null)
  const isDesktop = useMediaQuery('(min-width: 1180px)')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const { preference, resolvedAppearance, setPreference } = useAppearance()
  const {
    canGenerate,
    error: modelsError,
    isLoading: isLoadingModels,
    loadModels,
    models,
    selectedModel,
    setSelectedModel,
    warnings: modelWarnings,
  } = useAvailableModels()
  const { getReasoningEffort, reasoningEffort, setReasoningEffort } = useReasoningEffort(
    selectedModel,
    models,
  )
  const canGenerateForDeck = canGenerate && Boolean(deckId)

  useEffect(() => {
    let canceled = false
    void window.arkDesktop.mcp.getPendingInteraction().then((interaction) => {
      if (!canceled) setMcpInteraction(interaction)
    })
    const unsubscribe = window.arkDesktop.mcp.onInteractionChanged(({ interaction }) => {
      setMcpInteraction(interaction)
    })
    return () => {
      canceled = true
      unsubscribe()
    }
  }, [])

  const activeMcpInteraction = mcpInteraction?.deckId === deckId ? mcpInteraction : null

  const respondToMcpInteraction = useCallback(
    async (answer: McpInteractionAnswer) => {
      if (!activeMcpInteraction) return
      try {
        await window.arkDesktop.mcp.respondToInteraction(activeMcpInteraction.id, answer)
        toast.success('Response sent to the external agent')
      } catch (responseError) {
        toast.error(
          responseError instanceof Error ? responseError.message : 'Could not send the response',
        )
      }
    },
    [activeMcpInteraction],
  )

  const cancelMcpInteraction = useCallback(async () => {
    if (!activeMcpInteraction) return
    await window.arkDesktop.mcp.cancelInteraction(activeMcpInteraction.id)
  }, [activeMcpInteraction])

  const handleModelSelect = useCallback(
    (modelId: string, nextEffort?: ReasoningEffort) => {
      setSelectedModel(modelId)
      if (nextEffort) {
        setReasoningEffort(nextEffort, modelId)
      }
    },
    [setReasoningEffort, setSelectedModel],
  )

  const {
    canRedo,
    canUndo,
    commitRedo,
    commitUndo,
    redoEntry,
    record: recordEditHistory,
    reset: resetEditHistory,
    undoEntry,
  } = editHistory
  const undoRedoInFlightRef = useRef(false)

  const {
    activeJobId,
    activeSteps,
    cancelGeneration: handleCancelGeneration,
    failedJobId,
    generateDeck,
    generationError,
    generationStatus,
    isModelFailure,
    isPreviewUpdating,
    isGenerating,
    recentGenerationJobId,
    retryGeneration: handleRetryGeneration,
  } = useDeckGenerationFlow({
    deck: {
      deckId,
      documentRevision,
      generatedHtml,
      isDeckLoading,
      refreshActiveDeck,
    },
    chat: {
      messages,
      appendMessage,
      reloadChat,
      setMessages,
    },
    selectedModel,
    reasoningEffort,
    canGenerate: canGenerateForDeck,
    loadModels,
    onError: setError,
    onGenerationStart: useCallback(() => setAttachmentError(''), []),
    onGenerationSucceeded: useCallback(() => {
      setContextSlideEntries([])
      resetEditHistory()
    }, [resetEditHistory]),
  })

  useEffect(() => {
    startRevealThumbnailStylesPreload()

    let cancelled = false

    void waitForRevealThumbnailStylesPreload().then(() => {
      if (!cancelled) {
        setThumbnailStylesRevision((value) => value + 1)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const generatedHtmlRef = useRef(generatedHtml)
  const activeDeckIdRef = useRef(deckId)
  const documentRevisionRef = useRef(documentRevision)
  const externalBusyRef = useRef(false)
  const pendingExternalUpdateRef = useRef<ExternalDeckUpdate | null>(null)
  const applyingExternalUpdateRef = useRef(false)
  const [externalUpdateTick, setExternalUpdateTick] = useState(0)

  useEffect(() => {
    generatedHtmlRef.current = generatedHtml
  }, [generatedHtml])

  useEffect(() => {
    documentRevisionRef.current = documentRevision
  }, [documentRevision])

  useEffect(() => {
    activeDeckIdRef.current = deckId
    pendingExternalUpdateRef.current = null
  }, [deckId])

  useEffect(() => {
    void window.arkDesktop.mcp.setActiveDeck(
      deckId,
      deckId ? deckTitle : null,
      deckId ? documentRevision : null,
    )
  }, [deckId, deckTitle, documentRevision])

  useEffect(() => {
    externalBusyRef.current = isDeckSaving || isDeckPatching || isGenerating
    if (!externalBusyRef.current) setExternalUpdateTick((value) => value + 1)
  }, [isDeckPatching, isDeckSaving, isGenerating])

  useEffect(
    () =>
      window.arkDesktop.mcp.onDeckUpdated((update) => {
        if (
          update.deckId !== activeDeckIdRef.current ||
          update.documentRevision <= (documentRevisionRef.current ?? 0)
        ) {
          return
        }
        const pending = pendingExternalUpdateRef.current
        if (!pending || update.documentRevision > pending.documentRevision) {
          pendingExternalUpdateRef.current = update
        }
        setExternalUpdateTick((value) => value + 1)
      }),
    [],
  )

  useEffect(() => {
    const update = pendingExternalUpdateRef.current
    if (!update || externalBusyRef.current || applyingExternalUpdateRef.current) return
    pendingExternalUpdateRef.current = null
    applyingExternalUpdateRef.current = true
    const beforeHtml = generatedHtmlRef.current

    void refreshActiveDeck(update.deckId)
      .then((deck) => {
        if (
          activeDeckIdRef.current !== update.deckId ||
          !deck ||
          deck.documentRevision < update.documentRevision ||
          deck.html === beforeHtml
        ) {
          return
        }
        documentRevisionRef.current = deck.documentRevision
        generatedHtmlRef.current = deck.html
        recordEditHistory({
          beforeHtml,
          afterHtml: deck.html,
          slideIndex: 0,
          provenance: {
            source: 'external',
            clientName: update.clientName,
            toolName: update.toolName,
            summary: update.summary,
            createdAt: new Date().toISOString(),
          },
        })
        toast.success(`Updated by ${update.clientName ?? 'external agent'}`)
      })
      .catch((refreshError) => {
        toast.error(
          refreshError instanceof Error
            ? refreshError.message
            : 'Could not load the external deck update',
        )
      })
      .finally(() => {
        applyingExternalUpdateRef.current = false
        setExternalUpdateTick((value) => value + 1)
      })
  }, [externalUpdateTick, recordEditHistory, refreshActiveDeck])

  // Clear undo/redo history whenever the active deck changes (switch, new deck,
  // delete). AI generation, upload, and snapshot restores reset explicitly via callbacks.
  useEffect(() => {
    resetEditHistory()
  }, [deckId, resetEditHistory])

  const [prevDeckIdForContext, setPrevDeckIdForContext] = useState(deckId)
  if (deckId !== prevDeckIdForContext) {
    setPrevDeckIdForContext(deckId)
    setContextSlideEntries([])
    setEditorSelection(null)
  }

  const handleEditorSelectionChange = useCallback((selection: EditorSelectionInfo | null) => {
    setEditorSelection((current) => {
      if (current === selection) {
        return current
      }

      if (
        current &&
        selection &&
        current.elementId === selection.elementId &&
        current.slideIndex === selection.slideIndex &&
        current.slideId === selection.slideId &&
        current.tagName === selection.tagName &&
        current.locked === selection.locked &&
        current.managed === selection.managed &&
        current.editableKind === selection.editableKind &&
        current.textPreview === selection.textPreview &&
        current.surface === selection.surface &&
        current.geometryEditable === selection.geometryEditable &&
        current.role === selection.role &&
        current.imageFit === selection.imageFit
      ) {
        return current
      }

      return selection
    })
  }, [])

  const handleClearEditorSelection = useCallback(() => {
    const clear = clearEditorSelectionRef.current
    if (clear?.()) {
      // Bridge accepted the clear; selection change event will null local state.
      return
    }
    setEditorSelection(null)
  }, [])

  const deckAnalysis = useMemo(() => {
    void thumbnailStylesRevision
    return analyzeDeckInBrowser(generatedHtml, { assetOrigin: resolveAppOrigin(), deckId })
  }, [deckId, generatedHtml, thumbnailStylesRevision])

  const handleToggleContextSlide = useCallback(
    (slideIndex: number) => {
      const result = toggleContextSlideEntry(
        contextSlideEntries,
        slideIndex,
        deckAnalysis.slides,
        MAX_SLIDE_CONTEXTS,
      )
      if (result.capped) {
        toast.warning(`You can attach up to ${MAX_SLIDE_CONTEXTS} slides to the chat`)
        return
      }
      setContextSlideEntries(result.entries)
    },
    [contextSlideEntries, deckAnalysis.slides],
  )

  const handleRemoveContextSlide = useCallback(
    (slideIndex: number) => {
      setContextSlideEntries((current) =>
        resolveContextSlides(current, deckAnalysis.slides).filter(
          (entry) => entry.slideIndex !== slideIndex,
        ),
      )
    },
    [deckAnalysis.slides],
  )

  // Keep attached-slide state aligned with the live deck (reorder/delete/snapshot restore).
  const resolvedContextSlides = useMemo(
    () => resolveContextSlides(contextSlideEntries, deckAnalysis.slides),
    [contextSlideEntries, deckAnalysis.slides],
  )
  if (!sameContextSlideEntries(resolvedContextSlides, contextSlideEntries)) {
    setContextSlideEntries(resolvedContextSlides)
  }

  const contextSlideIndexes = useMemo(
    () => resolvedContextSlides.map((entry) => entry.slideIndex),
    [resolvedContextSlides],
  )

  const showSanitizedDownload = deckAnalysis.hasExecutableContent
  const hasSlides = deckAnalysis.slideCount > 0
  const displayError = error || generationError
  const contextSlidesForChips = useMemo(
    () =>
      resolvedContextSlides.flatMap((entry) => {
        const slide = deckAnalysis.slides.find((item) => item.index === entry.slideIndex)
        if (!slide) {
          return []
        }
        return [
          {
            slideIndex: entry.slideIndex,
            title: extractSlideTitleFromOuterHtml(slide.outerHTML, entry.slideIndex),
          },
        ]
      }),
    [deckAnalysis.slides, resolvedContextSlides],
  )
  const chatContextSlot =
    editorSelection || contextSlidesForChips.length > 0 ? (
      <ChatContextChips
        editorSelection={editorSelection}
        nested
        onClearEditorSelection={handleClearEditorSelection}
        onRemoveSlide={handleRemoveContextSlide}
        slides={contextSlidesForChips}
      />
    ) : null
  const chatDefaultSize = getChatPanelDefaultSize(mainSize.width)
  const deckDefaultSizeWithChat = getDeckPanelDefaultSizeWithChat(mainSize.width, chatDefaultSize)

  const {
    handleDownload,
    handleHtmlUpload,
    handleNewDeck: newDeckAction,
    handleRenameDeck,
    handleUploadClick,
  } = useDeckActions({
    fileInputRef,
    deck: {
      deckId,
      html: generatedHtml,
      persistHtml,
      startNewDeck,
      renameActiveDeck,
      deleteActiveDeck,
    },
    chat: {
      appendMessage,
      setMessages,
      resetChat,
    },
    setInput,
    setError,
    onEditHistoryBoundary: resetEditHistory,
  })

  const handleNewDeck = useCallback(async () => {
    await newDeckAction()
    navigate('/decks/new')
  }, [navigate, newDeckAction])

  const workspaceFileName = useMemo(
    () => `${deckTitle.replace(/[<>:"/\\|?*]/g, ' ').trim() || 'Untitled Presentation'}.ark`,
    [deckTitle],
  )
  const handleOpenWorkspace = useCallback(async () => {
    const path = await window.arkDesktop.files.openWorkspace()
    if (!path) return
    const deck = await openWorkspaceFile(path)
    navigate(`/decks/${deck.id}`)
  }, [navigate, openWorkspaceFile])
  const handleSaveAs = useCallback(async () => {
    const path = await window.arkDesktop.files.chooseWorkspacePath(workspaceFileName)
    if (path) await saveAs(path)
  }, [saveAs, workspaceFileName])
  const handleMove = useCallback(async () => {
    const path = await window.arkDesktop.files.chooseWorkspacePath(workspaceFileName)
    if (path) await moveTo(path)
  }, [moveTo, workspaceFileName])
  const handleDuplicate = useCallback(async () => {
    const deck = await duplicate('presentation')
    navigate(`/decks/${deck.id}`)
  }, [duplicate, navigate])
  const handleShareProject = useCallback(async () => {
    if (
      !window.confirm(
        'Share Ark Project may contain prompts, conversations, and source files. Continue?',
      )
    ) {
      return
    }
    const path = await window.arkDesktop.files.chooseWorkspacePath(workspaceFileName)
    if (path) await duplicate('complete', path)
  }, [duplicate, workspaceFileName])

  const handlePromptSubmit = async (message: PromptInputMessage) => {
    const hasAttachments = message.files.length > 0
    const hasContent = Boolean(message.text.trim() || hasAttachments)

    if (!hasContent || !canGenerate || !deckId) {
      return
    }

    const selectedModelInfo = models.find((model) => model.id === selectedModel)
    if (selectedModelInfo && !selectedModelInfo.supportsAttachments && hasAttachments) {
      setAttachmentError(
        `${selectedModelInfo.name ?? selectedModelInfo.modelId} is text-only and does not support attachments.`,
      )
      return
    }

    let attachments: ChatAttachment[]
    try {
      // Bound concurrency so large selections upload promptly without flooding the browser or API.
      attachments = await uploadPromptAttachments(deckId, message.files)
      setAttachmentError('')
    } catch (uploadError) {
      setAttachmentError(
        uploadError instanceof Error ? uploadError.message : 'Could not upload the attachment.',
      )
      return
    }

    setInput('')
    const assetIds = [
      ...new Set(attachments.flatMap((item) => (item.assetId ? [item.assetId] : []))),
    ]
    const editorSelectionContext = toEditorSelectionContext(editorSelection)
    const slideContexts =
      resolvedContextSlides.length > 0
        ? buildSlideContexts(resolvedContextSlides, deckAnalysis.slides)
        : undefined
    await generateDeck(message.text, attachments, {
      assetIds,
      ...(editorSelectionContext ? { editorSelection: editorSelectionContext } : {}),
      ...(slideContexts?.length ? { slideContexts } : {}),
    })
  }

  const recordManualEdit = useCallback(
    (
      beforeHtml: string,
      result: (PatchDeckResponse & { suggestedSlideIndex?: number }) | undefined,
      operations: DeckPatchOperation[],
      summary: string,
      slideIndex: number,
    ) => {
      if (!result?.deck) {
        return
      }

      generatedHtmlRef.current = result.deck.html
      recordEditHistory({
        beforeHtml,
        afterHtml: result.deck.html,
        slideIndex,
        provenance: buildManualEditProvenance({
          operations,
          summary,
          slideIndexes: result.patch.changedSlideIndexes,
          elementIds: result.patch.changedElementIds,
        }),
      })
    },
    [recordEditHistory],
  )

  const handleCommitTextEdit = useCallback(
    async (commit: {
      elementId: string
      slideIndex: number
      slideId: string | null
      text: string
    }) => {
      if (!deckId) {
        toast.error('Save the deck before editing text')
        throw new Error('Deck is not saved')
      }

      const operations: DeckElementPatchOperation[] = [
        {
          op: 'replace_text',
          elementId: commit.elementId,
          slideIndex: commit.slideIndex,
          ...(commit.slideId ? { slideId: commit.slideId } : {}),
          text: commit.text,
        },
      ]
      const summary = 'Edited text in preview'

      try {
        const result = await patchDeckOperations(operations, commit.slideIndex)
        recordManualEdit(
          result?.beforeHtml ?? generatedHtmlRef.current,
          result,
          operations,
          summary,
          commit.slideIndex,
        )
        return result
      } catch (patchError) {
        toast.error(
          patchError instanceof Error ? patchError.message : 'Could not save the text edit',
        )
        try {
          await refreshActiveDeck()
        } catch {
          // Ignore refresh failures after a failed patch.
        }
        throw patchError
      }
    },
    [deckId, patchDeckOperations, recordManualEdit, refreshActiveDeck],
  )

  const handlePatchEditorOperations = useCallback(
    async (operations: DeckElementPatchOperation[], activeSlideIndex: number, summary: string) => {
      if (!deckId) {
        toast.error('Save the deck before editing')
        throw new Error('Deck is not saved')
      }

      try {
        const result = await patchDeckOperations(operations, activeSlideIndex)
        recordManualEdit(
          result?.beforeHtml ?? generatedHtmlRef.current,
          result,
          operations,
          summary,
          activeSlideIndex,
        )
        return result
      } catch (patchError) {
        toast.error(patchError instanceof Error ? patchError.message : 'Could not save the edit')
        try {
          await refreshActiveDeck()
        } catch {
          // Ignore refresh failures after a failed patch.
        }
        throw patchError
      }
    },
    [deckId, patchDeckOperations, recordManualEdit, refreshActiveDeck],
  )

  const handleReorderSlide = useCallback(
    async (fromIndex: number, toIndex: number, activeSlideIndex: number) => {
      if (fromIndex === toIndex) {
        return undefined
      }

      const operations: DeckPatchOperation[] = [
        { op: 'reorder_slide', slideIndex: fromIndex, toIndex },
      ]
      const summary = `Moved slide ${fromIndex + 1} to position ${toIndex + 1}`

      try {
        const result = await patchDeckOperations(operations, activeSlideIndex)
        recordManualEdit(
          result?.beforeHtml ?? generatedHtmlRef.current,
          result,
          operations,
          summary,
          result?.suggestedSlideIndex ?? activeSlideIndex,
        )
        return result
      } catch (patchError) {
        toast.error('Could not reorder slide')
        try {
          await refreshActiveDeck()
        } catch {
          // Ignore refresh failures after a failed patch.
        }
        throw patchError
      }
    },
    [patchDeckOperations, recordManualEdit, refreshActiveDeck],
  )

  const handleUndoEdit = useCallback(async () => {
    if (undoRedoInFlightRef.current) {
      return
    }

    const entry = undoEntry

    if (!entry) {
      return
    }

    undoRedoInFlightRef.current = true

    try {
      const deck = await restoreHtmlSnapshot(entry.beforeHtml)

      if (deck) {
        commitUndo()
      }
    } catch (undoError) {
      toast.error(undoError instanceof Error ? undoError.message : 'Could not undo the last edit')
      try {
        await refreshActiveDeck()
      } catch {
        // Ignore refresh failures after a failed undo.
      }
    } finally {
      undoRedoInFlightRef.current = false
    }
  }, [commitUndo, refreshActiveDeck, restoreHtmlSnapshot, undoEntry])

  const handleRedoEdit = useCallback(async () => {
    if (undoRedoInFlightRef.current) {
      return
    }

    const entry = redoEntry

    if (!entry) {
      return
    }

    undoRedoInFlightRef.current = true

    try {
      const deck = await restoreHtmlSnapshot(entry.afterHtml)

      if (deck) {
        commitRedo()
      }
    } catch (redoError) {
      toast.error(redoError instanceof Error ? redoError.message : 'Could not redo the edit')
      try {
        await refreshActiveDeck()
      } catch {
        // Ignore refresh failures after a failed redo.
      }
    } finally {
      undoRedoInFlightRef.current = false
    }
  }, [commitRedo, refreshActiveDeck, restoreHtmlSnapshot, redoEntry])

  const chatPanel = (
    <ChatPanel
      activeJobId={activeJobId}
      activeSteps={activeSteps}
      attachmentError={attachmentError}
      canGenerate={canGenerateForDeck}
      contextSlot={chatContextSlot}
      error={displayError}
      failedJobId={failedJobId}
      generationStatus={generationStatus}
      getMessageDeliveryStatus={getMessageDeliveryStatus}
      getReasoningEffort={getReasoningEffort}
      input={input}
      isGenerating={isGenerating}
      isLoadingModels={isLoadingModels}
      messages={messages}
      mcpInteraction={activeMcpInteraction}
      models={models}
      modelsError={modelsError}
      modelWarnings={modelWarnings}
      onAttachmentError={setAttachmentError}
      onCancelGeneration={handleCancelGeneration}
      onInputChange={setInput}
      onModelSelect={handleModelSelect}
      onMcpInteractionCancel={() => {
        void cancelMcpInteraction()
      }}
      onMcpInteractionSubmit={(answer) => {
        void respondToMcpInteraction(answer)
      }}
      onPromptSubmit={handlePromptSubmit}
      onQuestionSubmit={(content) => {
        void generateDeck(content)
      }}
      onRetryGeneration={handleRetryGeneration}
      onRetryPersist={retryPersist}
      reducedMotion={reducedMotion}
      reasoningEffort={reasoningEffort}
      resolvedAppearance={resolvedAppearance}
      selectedModel={selectedModel}
      showGenerationErrorAlert={!isModelFailure}
    />
  )
  const deckPreview = (
    <MemoizedDeckPreview
      canRedo={canRedo}
      canUndo={canUndo}
      chromeHost={deckChromeHost}
      clearEditorSelectionRef={clearEditorSelectionRef}
      contextSlideIndexes={contextSlideIndexes}
      deckId={deckId}
      editorBridgeEnabled
      html={generatedHtml}
      initialSlideIndex={initialSlideIndex}
      isDeckLoading={Boolean(routeDeckId && isDeckLoading)}
      isGenerating={isGenerating}
      isPreviewUpdating={isPreviewUpdating}
      isStripOpen={isStripOpen}
      isTextEditSaving={isDeckPatching || isDeckSaving}
      layout={isDesktop ? 'desktop' : 'mobile'}
      onCommitTextEdit={handleCommitTextEdit}
      onEditorSelectionChange={handleEditorSelectionChange}
      onPatchEditorOperations={handlePatchEditorOperations}
      onReorderSlide={handleReorderSlide}
      presentHandleRef={deckPreviewRef}
      onRedo={handleRedoEdit}
      onToggleContextSlide={handleToggleContextSlide}
      onUndo={handleUndoEdit}
      deckAnalysis={deckAnalysis}
      redoSlideIndex={redoEntry?.slideIndex ?? null}
      recentGenerationJobId={recentGenerationJobId}
      undoSlideIndex={undoEntry?.slideIndex ?? null}
      documentRevision={documentRevision}
    />
  )

  return (
    <TooltipProvider>
      <div className="flex h-svh min-h-0 flex-col bg-[var(--ark-canvas)] text-foreground">
        <AppTitleBar
          activeDeckId={deckId}
          deckTitle={deckTitle}
          fileInputRef={fileInputRef}
          hasDeck={hasDeck}
          hasSlides={hasSlides}
          isChatOpen={isChatOpen}
          isGenerating={isGenerating}
          isStripOpen={isStripOpen}
          appearancePreference={preference}
          onDownload={handleDownload}
          onHtmlUpload={handleHtmlUpload}
          onCredentialsChanged={loadModels}
          onNewDeck={handleNewDeck}
          onOpenWorkspace={handleOpenWorkspace}
          onSaveAs={handleSaveAs}
          onMove={handleMove}
          onReveal={() => filePath && void window.arkDesktop.files.reveal(filePath)}
          onDuplicate={handleDuplicate}
          onShareProject={handleShareProject}
          onPresent={() => deckPreviewRef.current?.openPresent()}
          onRenameDeck={handleRenameDeck}
          onToggleChat={() => setIsChatOpen((current) => !current)}
          onToggleStrip={() => setIsStripOpen((current) => !current)}
          onAppearanceChange={setPreference}
          onUploadClick={handleUploadClick}
          showSanitizedDownload={showSanitizedDownload}
        />

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden" ref={mainRef}>
          <div className="shrink-0" ref={setDeckChromeHost} />
          {isDesktop ? (
            <ResizablePanelGroup
              className="min-h-0 flex-1 overflow-hidden"
              orientation="horizontal"
            >
              <ResizablePanel
                defaultSize={isChatOpen ? deckDefaultSizeWithChat : '100%'}
                minSize={isChatOpen ? '55%' : '100%'}
              >
                {deckPreview}
              </ResizablePanel>
              {isChatOpen ? (
                <>
                  <ResizableHandle className="border-[var(--ark-line)]" />
                  <ResizablePanel
                    defaultSize={chatDefaultSize}
                    id="ark-chat-panel"
                    maxSize={460}
                    minSize={CHAT_PANEL_MIN_WIDTH_PX}
                  >
                    {chatPanel}
                  </ResizablePanel>
                </>
              ) : null}
            </ResizablePanelGroup>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-hidden">{deckPreview}</div>
              <Sheet onOpenChange={setIsChatOpen} open={isChatOpen}>
                <SheetContent
                  aria-describedby="ark-agent-sheet-description"
                  aria-labelledby="ark-agent-sheet-title"
                  className="gap-0 p-0"
                  forceMount
                  id="ark-chat-panel"
                  showCloseButton={false}
                >
                  <SheetTitle className="sr-only" id="ark-agent-sheet-title">
                    Agent
                  </SheetTitle>
                  <SheetDescription className="sr-only" id="ark-agent-sheet-description">
                    Build and edit the current deck with Ark.
                  </SheetDescription>
                  {chatPanel}
                </SheetContent>
              </Sheet>
            </>
          )}
        </main>
      </div>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}

export default App
