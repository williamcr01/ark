import { useMemo, useRef, useState, useEffect, useCallback } from 'react'

import {
  MAX_CHAT_ATTACHMENTS,
  toChatAttachments,
  type ChatAttachment,
} from '@ark/deck-core/chat.ts'
import { toast } from 'sonner'

import { AppTitleBar, type DeckSaveStatus } from '@/components/AppTitleBar'
import { ChatPanel } from '@/components/ChatPanel'
import { DeckAssets } from '@/components/DeckAssets'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import { DeckPreview } from '@/components/DeckPreview'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAvailableModels } from '@/hooks/useAvailableModels'
import { useAppearance } from '@/hooks/useAppearance'
import { useReasoningEffort, type ReasoningEffort } from '@/hooks/useReasoningEffort'
import { useChatSession } from '@/hooks/useChatSession'
import { useDeckAssets } from '@/hooks/useDeckAssets'
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
import type { DeckElementPatchOperation } from '@ark/deck-core/deck-patch.ts'
import type { EditorSelectionInfo } from '@ark/deck-core/deck-editor-bridge.ts'
import { buildManualEditProvenance } from '@ark/deck-core/deck-edit-provenance.ts'
import { buildUndoRedoVersionOptions } from '@/lib/undo-redo-version-options'
import { toEditorSelectionContext } from '@/lib/editor-selection-context'
import type { PatchDeckResponse } from '@/lib/deck-api'
import {
  startRevealThumbnailStylesPreload,
  waitForRevealThumbnailStylesPreload,
} from '@ark/runtime-registry/runtime-stylesheet-content.ts'

function App() {
  const {
    activeVersionId,
    clearVersionPreview,
    hasDeck,
    html: generatedHtml,
    inspectVersion,
    isDirty,
    isLoading: isDeckLoading,
    isLoadingVersions,
    isSaving: isDeckSaving,
    isPatching: isDeckPatching,
    deckId,
    deckTitle,
    decks,
    deleteActiveDeck,
    patchDeckOperations,
    persistHtml,
    previewVersion,
    refreshActiveDeck,
    refreshVersions,
    renameActiveDeck,
    restoreHtmlSnapshot,
    rollbackToVersion,
    saveError,
    selectDeck,
    startNewDeck,
    versionNumber,
    versions,
  } = useDeckPersistence()
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
    deckVersionId: activeVersionId,
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
  const {
    assets: deckAssets,
    uploads: assetUploads,
    selectedAssetIds,
    error: assetError,
    removeAsset,
    dismissUpload,
    toggleAssetSelected,
    clearSelection: clearAssetSelection,
  } = useDeckAssets(deckId)
  const [input, setInput] = useState('')
  const editorSelectionRef = useRef<EditorSelectionInfo | null>(null)
  const [isChatOpen, setIsChatOpen] = useState(true)
  const [isStripOpen, setIsStripOpen] = useState(true)
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
      activeVersionId,
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
    canGenerate,
    loadModels,
    onError: setError,
    onGenerationStart: useCallback(() => setAttachmentError(''), []),
    onGenerationSucceeded: useCallback(() => {
      clearAssetSelection()
      resetEditHistory()
    }, [clearAssetSelection, resetEditHistory]),
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

  useEffect(() => {
    generatedHtmlRef.current = generatedHtml
  }, [generatedHtml])

  // Clear undo/redo history whenever the active deck changes (switch, new deck,
  // delete). AI generation, upload, and rollback reset explicitly via callbacks.
  useEffect(() => {
    resetEditHistory()
  }, [deckId, resetEditHistory])

  const deckAnalysis = useMemo(() => {
    void thumbnailStylesRevision
    return analyzeDeckInBrowser(generatedHtml)
  }, [generatedHtml, thumbnailStylesRevision])
  const showSanitizedDownload = deckAnalysis.hasExecutableContent
  const hasSlides = deckAnalysis.slideCount > 0
  const deckSaveStatus: DeckSaveStatus = isDeckLoading
    ? 'loading'
    : isGenerating
      ? 'generating'
      : isDeckSaving
        ? 'saving'
        : saveError
          ? 'error'
          : isDirty
            ? 'dirty'
            : hasDeck
              ? 'saved'
              : 'new'
  const displayError = error || generationError
  const deckAssetsSlot = deckId ? (
    <DeckAssets
      assets={deckAssets}
      error={assetError}
      onDismissUpload={dismissUpload}
      onRemoveAsset={removeAsset}
      onToggleSelected={toggleAssetSelected}
      selectedAssetIds={selectedAssetIds}
      uploads={assetUploads}
    />
  ) : null
  const chatDefaultSize = getChatPanelDefaultSize(mainSize.width)
  const deckDefaultSizeWithChat = getDeckPanelDefaultSizeWithChat(mainSize.width, chatDefaultSize)

  const {
    handleDeleteDeck,
    handleDownload,
    handleHtmlUpload,
    handleNewDeck,
    handleRenameDeck,
    handleRollbackVersion,
    handleSelectDeck,
    handleUploadClick,
  } = useDeckActions({
    fileInputRef,
    deck: {
      deckId,
      html: generatedHtml,
      persistHtml,
      rollbackToVersion,
      selectDeck,
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

  const handleEditorSelectionChange = useCallback((selection: EditorSelectionInfo | null) => {
    editorSelectionRef.current = selection
  }, [])

  const handlePromptSubmit = async (message: PromptInputMessage) => {
    const promptAttachments = toChatAttachments(message.files)
    const selectedDeckAttachments: ChatAttachment[] = deckId
      ? selectedAssetIds
          .map((id) => deckAssets.find((asset) => asset.id === id))
          .filter((asset): asset is (typeof deckAssets)[number] => Boolean(asset))
          .map((asset) => ({
            type: 'file' as const,
            mediaType: asset.mediaType,
            filename: asset.filename,
            url: asset.url,
            assetId: asset.id,
          }))
      : []
    const attachments = [...selectedDeckAttachments, ...promptAttachments]
    const hasContent = Boolean(message.text.trim() || attachments.length > 0)

    if (!hasContent || !canGenerate) {
      return
    }

    const selectedModelInfo = models.find((model) => model.id === selectedModel)
    if (selectedModelInfo?.supportsAttachments === false && attachments.length > 0) {
      setAttachmentError(
        `${selectedModelInfo.name ?? selectedModelInfo.modelId} is text-only and does not support attachments.`,
      )
      return
    }

    if (attachments.length > MAX_CHAT_ATTACHMENTS) {
      setAttachmentError(`You can attach up to ${MAX_CHAT_ATTACHMENTS} files per message.`)
      return
    }

    setInput('')
    const assetIds = deckId ? selectedAssetIds : []
    const editorSelection = toEditorSelectionContext(editorSelectionRef.current)
    await generateDeck(message.text, attachments, {
      assetIds,
      ...(editorSelection ? { editorSelection } : {}),
    })
  }

  const recordManualEdit = useCallback(
    (
      beforeHtml: string,
      result: (PatchDeckResponse & { suggestedSlideIndex?: number }) | undefined,
      operations: DeckElementPatchOperation[],
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
        const result = await patchDeckOperations(operations, commit.slideIndex, { summary })
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
        const result = await patchDeckOperations(operations, activeSlideIndex, { summary })
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
      const deck = await restoreHtmlSnapshot(
        entry.beforeHtml,
        buildUndoRedoVersionOptions('undo', entry),
      )

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
      const deck = await restoreHtmlSnapshot(
        entry.afterHtml,
        buildUndoRedoVersionOptions('redo', entry),
      )

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
      activeSteps={activeSteps}
      assetsSlot={deckAssetsSlot}
      attachmentError={attachmentError}
      canGenerate={canGenerate}
      error={displayError}
      failedJobId={failedJobId}
      generationStatus={generationStatus}
      getMessageDeliveryStatus={getMessageDeliveryStatus}
      getReasoningEffort={getReasoningEffort}
      input={input}
      isGenerating={isGenerating}
      isLoadingModels={isLoadingModels}
      messages={messages}
      models={models}
      modelsError={modelsError}
      modelWarnings={modelWarnings}
      onAttachmentError={setAttachmentError}
      onCancelGeneration={handleCancelGeneration}
      onInputChange={setInput}
      onModelSelect={handleModelSelect}
      onPromptSubmit={handlePromptSubmit}
      onRetryGeneration={handleRetryGeneration}
      onRetryPersist={retryPersist}
      reducedMotion={reducedMotion}
      reasoningEffort={reasoningEffort}
      resolvedAppearance={resolvedAppearance}
      selectedAssetIds={selectedAssetIds}
      selectedModel={selectedModel}
      showGenerationErrorAlert={!isModelFailure}
    />
  )
  const deckPreview = (
    <DeckPreview
      canRedo={canRedo}
      canUndo={canUndo}
      chromeHost={deckChromeHost}
      deckId={deckId}
      editorBridgeEnabled
      html={generatedHtml}
      isGenerating={isGenerating}
      isPreviewUpdating={isPreviewUpdating}
      isStripOpen={isStripOpen}
      isTextEditSaving={isDeckPatching || isDeckSaving}
      layout={isDesktop ? 'desktop' : 'mobile'}
      onCommitTextEdit={handleCommitTextEdit}
      onEditorSelectionChange={handleEditorSelectionChange}
      onPatchEditorOperations={handlePatchEditorOperations}
      onRedo={handleRedoEdit}
      onUndo={handleUndoEdit}
      deckAnalysis={deckAnalysis}
      redoSlideIndex={redoEntry?.slideIndex ?? null}
      recentGenerationJobId={recentGenerationJobId}
      undoSlideIndex={undoEntry?.slideIndex ?? null}
      versionId={activeVersionId}
    />
  )

  return (
    <TooltipProvider>
      <div className="flex h-svh min-h-0 flex-col bg-[var(--ark-canvas)] text-foreground">
        <AppTitleBar
          activeDeckId={deckId}
          activeVersionId={activeVersionId}
          deckTitle={deckTitle}
          deckSaveStatus={deckSaveStatus}
          decks={decks}
          fileInputRef={fileInputRef}
          hasDeck={hasDeck}
          hasSlides={hasSlides}
          isChatOpen={isChatOpen}
          isGenerating={isGenerating}
          isLoadingVersions={isLoadingVersions}
          isStripOpen={isStripOpen}
          appearancePreference={preference}
          resolvedAppearance={resolvedAppearance}
          onClearVersionPreview={clearVersionPreview}
          onDeleteDeck={handleDeleteDeck}
          onDownload={handleDownload}
          onHtmlUpload={handleHtmlUpload}
          onInspectVersion={inspectVersion}
          onNewDeck={handleNewDeck}
          onRefreshVersions={() => (deckId ? refreshVersions(deckId) : Promise.resolve([]))}
          onRenameDeck={handleRenameDeck}
          onRollbackVersion={handleRollbackVersion}
          onSelectDeck={handleSelectDeck}
          onToggleChat={() => setIsChatOpen((current) => !current)}
          onToggleStrip={() => setIsStripOpen((current) => !current)}
          onAppearanceChange={setPreference}
          onUploadClick={handleUploadClick}
          previewVersion={previewVersion}
          showSanitizedDownload={showSanitizedDownload}
          versionNumber={versionNumber}
          versions={versions}
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
                  <ResizableHandle withHandle />
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
