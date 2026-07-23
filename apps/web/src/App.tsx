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
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAvailableModels } from '@/hooks/useAvailableModels'
import { useReasoningEffort } from '@/hooks/useReasoningEffort'
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
  const isDesktop = useMediaQuery('(min-width: 1024px)')
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
  const { reasoningEffort, setReasoningEffort } = useReasoningEffort()

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
    isGenerating,
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
      onModelChange={setSelectedModel}
      onReasoningEffortChange={setReasoningEffort}
      onPromptSubmit={handlePromptSubmit}
      onRetryGeneration={handleRetryGeneration}
      onRetryPersist={retryPersist}
      reasoningEffort={reasoningEffort}
      selectedAssetIds={selectedAssetIds}
      selectedModel={selectedModel}
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
          onUploadClick={handleUploadClick}
          previewVersion={previewVersion}
          showSanitizedDownload={showSanitizedDownload}
          versionNumber={versionNumber}
          versions={versions}
        />

        <main className="min-h-0 flex-1 overflow-hidden" ref={mainRef}>
          {isDesktop ? (
            <ResizablePanelGroup className="min-h-0 overflow-hidden" orientation="horizontal">
              <ResizablePanel
                defaultSize={isChatOpen ? deckDefaultSizeWithChat : '100%'}
                minSize={isChatOpen ? '45%' : '100%'}
              >
                <DeckPreview
                  canRedo={canRedo}
                  canUndo={canUndo}
                  deckId={deckId}
                  editorBridgeEnabled
                  html={generatedHtml}
                  isGenerating={isGenerating}
                  isStripOpen={isStripOpen}
                  isTextEditSaving={isDeckPatching || isDeckSaving}
                  layout="desktop"
                  onCommitTextEdit={handleCommitTextEdit}
                  onEditorSelectionChange={handleEditorSelectionChange}
                  onPatchEditorOperations={handlePatchEditorOperations}
                  onRedo={handleRedoEdit}
                  onUndo={handleUndoEdit}
                  deckAnalysis={deckAnalysis}
                  redoSlideIndex={redoEntry?.slideIndex ?? null}
                  undoSlideIndex={undoEntry?.slideIndex ?? null}
                  versionId={activeVersionId}
                />
              </ResizablePanel>
              {isChatOpen ? (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel
                    defaultSize={chatDefaultSize}
                    id="ark-chat-panel"
                    minSize={CHAT_PANEL_MIN_WIDTH_PX}
                  >
                    {chatPanel}
                  </ResizablePanel>
                </>
              ) : null}
            </ResizablePanelGroup>
          ) : (
            <div
              className={
                isChatOpen
                  ? 'grid h-full min-h-0 grid-rows-[minmax(320px,0.9fr)_minmax(420px,1fr)]'
                  : 'h-full min-h-0'
              }
            >
              <div className="min-h-0 overflow-hidden">
                <DeckPreview
                  canRedo={canRedo}
                  canUndo={canUndo}
                  deckId={deckId}
                  editorBridgeEnabled
                  html={generatedHtml}
                  isGenerating={isGenerating}
                  isStripOpen={isStripOpen}
                  isTextEditSaving={isDeckPatching || isDeckSaving}
                  layout="mobile"
                  onCommitTextEdit={handleCommitTextEdit}
                  onEditorSelectionChange={handleEditorSelectionChange}
                  onPatchEditorOperations={handlePatchEditorOperations}
                  onRedo={handleRedoEdit}
                  onUndo={handleUndoEdit}
                  deckAnalysis={deckAnalysis}
                  redoSlideIndex={redoEntry?.slideIndex ?? null}
                  undoSlideIndex={undoEntry?.slideIndex ?? null}
                  versionId={activeVersionId}
                />
              </div>
              {isChatOpen ? (
                <div className="min-h-0 overflow-hidden" id="ark-chat-panel">
                  {chatPanel}
                </div>
              ) : null}
            </div>
          )}
        </main>
      </div>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}

export default App
