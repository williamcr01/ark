import { useMemo, useRef, useState, useEffect, useCallback, useEffectEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'

import { type ChatAttachment } from '@ark/chat/chat.ts'
import type { DeckExportFormat } from '@/lib/deck/deck-export'
import { toast } from 'sonner'

import { ChatContextChips } from '@/components/ChatContextChips'
import { ChatPanel } from '@/components/ChatPanel'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import type { DeckPreviewHandle } from '@/components/DeckPreview'
import { MemoizedDeckPreview } from '@/components/MemoizedDeckPreview'
import { useAvailableModels } from '@/hooks/useAvailableModels'
import { useAppearance } from '@/hooks/useAppearance'
import { useReasoningEffort, type ReasoningEffort } from '@/hooks/useReasoningEffort'
import { useChatSession } from '@/hooks/useChatSession'
import { useDeckActions } from '@/hooks/useDeckActions'
import { useMcpInteraction } from '@/hooks/useMcpInteraction'
import { useDeckEditHistory } from '@/hooks/useDeckEditHistory'
import { useDeckGenerationFlow } from '@/hooks/useDeckGenerationFlow'
import { useDeckPersistence } from '@/hooks/useDeckPersistence'
import { useElementSize } from '@/hooks/useElementSize'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import {
  getChatPanelDefaultSize,
  getDeckPanelDefaultSizeWithChat,
} from '@/lib/chat/chat-panel-layout'
import { analyzeDeckInBrowser } from '@/lib/deck/deck-analysis'
import { findPendingAgentQuestions } from '@/lib/chat/agent-questions'
import { findPendingThemeProposal } from '@/lib/chat/agent-themes'
import { getDesktopSettings } from '@/lib/ui/desktop-settings'
import type {
  DeckElementPatchOperation,
  DeckPatchOperation,
} from '@ark/deck/patch/patch-request.ts'
import type { EditorSelectionInfo } from '@ark/editor-runtime'
import { buildManualEditProvenance } from '@ark/deck/document/edit-provenance.ts'
import { ApiResponseError, MAX_SLIDE_CONTEXTS, type ExternalDeckUpdate } from '@ark/contracts'
import { toEditorSelectionContext } from '@/lib/editor/editor-selection-context'
import {
  buildSlideContexts,
  extractSlideTitleFromOuterHtml,
  resolveContextSlides,
  sameContextSlideEntries,
  toggleContextSlideEntry,
  type ContextSlideEntry,
} from '@/lib/deck/slide-context'
import type { PatchDeckResponse } from '@/lib/api/deck-api'
import { uploadDeckAsset } from '@/lib/api/asset-api'
import {
  startRevealThumbnailStylesPreload,
  waitForRevealThumbnailStylesPreload,
} from '@ark/runtime-registry/runtime-stylesheet-content.ts'
import { resolveAppOrigin } from '@ark/runtime-registry/sandbox-origin.ts'

import {
  loadChatOpenPreference,
  parseInitialSlideIndex,
  storeChatOpenPreference,
} from '@/lib/ui/app-shell-preferences'

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

export function useAppShell() {
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
  const isDesktop = useMediaQuery('(min-width: 1180px)')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [input, setInput] = useState('')
  const [agentInteractionsInModal, setAgentInteractionsInModal] = useState(
    () => getDesktopSettings().agentInteractionsInModal === true,
  )
  const [editorSelection, setEditorSelection] = useState<EditorSelectionInfo | null>(null)
  const [editorSelections, setEditorSelections] = useState<EditorSelectionInfo[]>([])
  const clearEditorSelectionRef = useRef<(() => boolean) | null>(null)
  const [contextSlideEntries, setContextSlideEntries] = useState<ContextSlideEntry[]>([])
  // The agent panel preference persists across sessions; layout defaults apply when unset
  // (open side-by-side on desktop, closed as a drawer on narrow windows). The drawer must
  // never force itself open over the deck, so it closes when the layout collapses to mobile.
  const [isChatOpen, setIsChatOpen] = useState<boolean>(() => loadChatOpenPreference() ?? isDesktop)
  const [isStripOpen, setIsStripOpen] = useState(true)
  // When the layout collapses to mobile, close the agent drawer *before* the sheet mounts so
  // it never pops open over the deck and never races a close the user makes at the same
  // moment (an effect-based close happened a frame too late: the drawer mounted open, then
  // closed, and a close click in between reopened it). React re-renders immediately when
  // state is set during render, so the sheet mounts closed. This is a layout accommodation,
  // not a user preference, so it is not persisted.
  const [prevIsDesktop, setPrevIsDesktop] = useState(isDesktop)
  if (prevIsDesktop !== isDesktop) {
    // React re-renders immediately after render-phase state updates, so the
    // sheet still mounts closed (React "adjusting state during render"
    // pattern — storing the previous value in state instead of mutating a
    // ref, which render must stay pure of).
    setPrevIsDesktop(isDesktop)
    if (!isDesktop && isChatOpen) {
      setIsChatOpen(false)
    }
  }
  const handleToggleChat = useCallback(() => {
    const next = !isChatOpen
    setIsChatOpen(next)
    storeChatOpenPreference(next)
  }, [isChatOpen])
  const handleChatOpenChange = useCallback(
    (open: boolean) => {
      // Radix reports only user-initiated changes (close button, ESC, outside click);
      // programmatic `open` prop changes never reach this callback. While the drawer is
      // closed it stays force-mounted, so stray outside interactions still fire this
      // callback with `false`; skip them instead of clobbering the stored preference.
      if (open === isChatOpen) {
        return
      }
      setIsChatOpen(open)
      storeChatOpenPreference(open)
    },
    [isChatOpen],
  )
  const handleChatShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
      return
    }
    if (event.key.toLowerCase() !== 'b') {
      return
    }
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
    ) {
      return
    }
    event.preventDefault()
    handleToggleChat()
  })
  // Toggle the agent panel with Ctrl/Cmd+B, mirroring common sidebar shortcuts.
  useEffect(() => {
    window.addEventListener('keydown', handleChatShortcut)
    return () => window.removeEventListener('keydown', handleChatShortcut)
  }, [])
  const deckPreviewRef = useRef<DeckPreviewHandle>(null)
  const [error, setError] = useState('')
  const [attachmentError, setAttachmentError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [thumbnailStylesRevision, setThumbnailStylesRevision] = useState(0)
  const [mainRef, mainSize] = useElementSize<HTMLElement>()
  const [deckChromeHost, setDeckChromeHost] = useState<HTMLDivElement | null>(null)
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

  const { activeMcpInteraction, cancelMcpInteraction, respondToMcpInteraction } =
    useMcpInteraction(deckId)

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

  const normalAgentQuestions = agentInteractionsInModal ? findPendingAgentQuestions(messages) : null
  const normalThemeProposal = agentInteractionsInModal ? findPendingThemeProposal(messages) : null

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
    setEditorSelections([])
  }

  const handleEditorSelectionChange = useCallback(
    (selection: EditorSelectionInfo | null, selections: EditorSelectionInfo[] = []) => {
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
      setEditorSelections(selections)
    },
    [],
  )

  const handleClearEditorSelection = useCallback(() => {
    const clear = clearEditorSelectionRef.current
    if (clear?.()) {
      // Bridge accepted the clear; selection change event will null local state.
      return
    }
    setEditorSelection(null)
    setEditorSelections([])
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

  const handleClearContextSlides = useCallback(() => {
    setContextSlideEntries([])
  }, [])

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
    editorSelection || editorSelections.length > 0 || contextSlidesForChips.length > 0 ? (
      <ChatContextChips
        editorSelection={editorSelection}
        editorSelections={editorSelections}
        nested
        onClearEditorSelection={handleClearEditorSelection}
        onClearSlides={handleClearContextSlides}
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
      deckTitle,
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

  const [exportingDeck, setExportingDeck] = useState<DeckExportFormat | false>(false)
  const handleExport = useCallback(
    async (format: DeckExportFormat) => {
      // Rendering a deck opens a hidden window per run, so one export at a
      // time: a second click would otherwise stack save dialogs and renders.
      if (exportingDeck || !deckId || !generatedHtml) return

      const label = format === 'pdf' ? 'PDF' : 'PowerPoint'
      setExportingDeck(format)
      const pending = toast.loading(`Exporting ${label}...`)
      try {
        const result = await window.arkDesktop.export.create({
          format,
          html: generatedHtml,
          title: deckTitle,
        })
        if (result.ok) {
          toast.success(
            result.warning ? `${label} exported - ${result.warning}` : `${label} exported`,
            {
              id: pending,
            },
          )
        } else if (result.canceled) {
          toast.dismiss(pending)
        } else {
          toast.error(result.error ?? 'Could not export deck.', { id: pending })
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not export deck.', {
          id: pending,
        })
      } finally {
        setExportingDeck(false)
      }
    },
    [deckId, deckTitle, exportingDeck, generatedHtml],
  )

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
  /**
   * Pick a workspace path and run a save-style action, resolving conflicts with
   * the user instead of failing silently: an existing file offers overwrite or
   * re-picking a different name; an already-open workspace asks for a different
   * name. The dialog reopens at the conflicting path so the new name lands in
   * the same location.
   */
  const runWorkspacePickFlow = useCallback(
    async (
      action: (path: string, overwrite: boolean) => Promise<unknown>,
      successMessage: string,
    ) => {
      let suggestedPath: string | null = null

      for (;;) {
        const path = await window.arkDesktop.files.chooseWorkspacePath(
          workspaceFileName,
          suggestedPath ?? undefined,
        )
        if (!path) return

        try {
          await action(path, false)
          toast.success(successMessage)
          return
        } catch (error) {
          if (error instanceof ApiResponseError && error.code === 'workspace_file_exists') {
            const fileName = path.split(/[\\/]/).pop() ?? path
            const overwrite = window.confirm(
              `"${fileName}" already exists in that location. Overwrite it?`,
            )

            if (!overwrite) {
              suggestedPath = path
              continue
            }

            try {
              await action(path, true)
              toast.success(successMessage)
            } catch (overwriteError) {
              toast.error(
                overwriteError instanceof Error
                  ? overwriteError.message
                  : 'Could not save the workspace.',
              )
            }
            return
          }

          if (error instanceof ApiResponseError && error.code === 'workspace_already_open') {
            toast.error('That workspace is already open in Ark. Choose a different name.')
            suggestedPath = path
            continue
          }

          toast.error(error instanceof Error ? error.message : 'Could not save the workspace.')
          return
        }
      }
    },
    [workspaceFileName],
  )

  const handleSaveAs = useCallback(
    () => runWorkspacePickFlow((path, overwrite) => saveAs(path, overwrite), 'Workspace saved'),
    [runWorkspacePickFlow, saveAs],
  )
  const handleMove = useCallback(
    () => runWorkspacePickFlow((path, overwrite) => moveTo(path, overwrite), 'Workspace moved'),
    [runWorkspacePickFlow, moveTo],
  )
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
    await runWorkspacePickFlow(
      (path, overwrite) => duplicate('complete', path, overwrite),
      'Ark project shared',
    )
  }, [duplicate, runWorkspacePickFlow])

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
      contextSlot={chatContextSlot}
      error={displayError}
      failedJobId={failedJobId}
      generationState={{
        canGenerate: canGenerateForDeck,
        isGenerating,
        isLoadingModels,
        showGenerationErrorAlert: !isModelFailure,
      }}
      generationStatus={generationStatus}
      getMessageDeliveryStatus={getMessageDeliveryStatus}
      getReasoningEffort={getReasoningEffort}
      input={input}
      interactiveToolsInModal={agentInteractionsInModal}
      messages={messages}
      models={models}
      modelsError={modelsError}
      modelWarnings={modelWarnings}
      onAttachmentError={setAttachmentError}
      onCancelGeneration={handleCancelGeneration}
      onInputChange={setInput}
      onModelSelect={handleModelSelect}
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
    />
  )
  const deckPreviewState = useMemo(
    () => ({
      canRedo,
      canUndo,
      editorBridgeEnabled: true,
      isDeckLoading: Boolean(routeDeckId && isDeckLoading),
      isGenerating,
      isPreviewUpdating,
      isStripOpen,
      isTextEditSaving: isDeckPatching || isDeckSaving,
    }),
    [
      canRedo,
      canUndo,
      isDeckLoading,
      isDeckPatching,
      isDeckSaving,
      isGenerating,
      isPreviewUpdating,
      isStripOpen,
      routeDeckId,
    ],
  )
  const deckPreview = (
    <MemoizedDeckPreview
      state={deckPreviewState}
      chromeHost={deckChromeHost}
      clearEditorSelectionRef={clearEditorSelectionRef}
      contextSlideIndexes={contextSlideIndexes}
      deckId={deckId}
      html={generatedHtml}
      initialSlideIndex={initialSlideIndex}
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

  return {
    activeMcpInteraction,
    canGenerateForDeck,
    cancelMcpInteraction,
    chatContextSlot,
    chatDefaultSize,
    chatPanel,
    deckDefaultSizeWithChat,
    deckPreview,
    deckId,
    deckPreviewRef,
    deckTitle,
    fileInputRef,
    filePath,
    generateDeck,
    handleChatOpenChange,
    handleDownload,
    handleDuplicate,
    handleExport,
    exportingDeck,
    handleHtmlUpload,
    handleMove,
    handleNewDeck,
    handleOpenWorkspace,
    handleRenameDeck,
    handleSaveAs,
    handleShareProject,
    handleToggleChat,
    handleUploadClick,
    hasDeck,
    hasSlides,
    isChatOpen,
    isDesktop,
    isGenerating,
    isStripOpen,
    loadModels,
    mainRef,
    normalAgentQuestions,
    normalThemeProposal,
    preference,
    respondToMcpInteraction,
    setAgentInteractionsInModal,
    setDeckChromeHost,
    setIsStripOpen,
    setPreference,
    showSanitizedDownload,
  }
}
