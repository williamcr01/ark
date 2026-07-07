import { useMemo, useRef, useState, useEffect, useCallback, type ChangeEvent } from 'react'

import { MAX_CHAT_ATTACHMENTS, toChatAttachments, type ChatAttachment } from '../shared/chat.ts'
import { toast } from 'sonner'

import { AppTitleBar, type DeckSaveStatus } from '@/components/AppTitleBar'
import { ChatPanel, type ChatMessage } from '@/components/ChatPanel'
import { DeckAssets } from '@/components/DeckAssets'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import { DeckPreview } from '@/components/DeckPreview'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAvailableModels } from '@/hooks/useAvailableModels'
import { useChatSession } from '@/hooks/useChatSession'
import { useDeckAssets } from '@/hooks/useDeckAssets'
import { useDeckPersistence } from '@/hooks/useDeckPersistence'
import { useGenerationJob, type GenerationJobOutcome } from '@/hooks/useGenerationJob'
import { useElementSize } from '@/hooks/useElementSize'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import {
  CHAT_PANEL_MIN_WIDTH_PX,
  getChatPanelDefaultSize,
  getDeckPanelDefaultSizeWithChat,
} from '@/lib/chat-panel-layout'
import {
  describeDeckValidation,
  downloadHtml,
  isHtmlDeckFile,
  validateUploadedDeck,
} from '@/lib/deck-io'
import { deckHasExecutableContent, type DeckDownloadVariant } from '@/lib/deck-export'
import { parseDeckSlides } from '@/lib/deck-slides'
import type { DeckValidationReport } from '../shared/deck-validate.ts'
import type { DeckElementPatchOperation } from '../shared/deck-patch.ts'
import { newId } from '@/lib/id'
import {
  startRevealThumbnailStylesPreload,
  waitForRevealThumbnailStylesPreload,
} from '../shared/runtime-stylesheet-content.ts'

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
    rollbackToVersion,
    saveError,
    selectDeck,
    startNewDeck,
    versionNumber,
    versions,
  } = useDeckPersistence()
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
    uploadFiles: uploadAssetFiles,
    removeAsset,
    dismissUpload,
    toggleAssetSelected,
    clearSelection: clearAssetSelection,
  } = useDeckAssets(deckId)
  const [input, setInput] = useState('')
  const [isChatOpen, setIsChatOpen] = useState(true)
  const [isStripOpen, setIsStripOpen] = useState(true)
  const [error, setError] = useState('')
  const [attachmentError, setAttachmentError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [thumbnailStylesRevision, setThumbnailStylesRevision] = useState(0)
  const recoveredJobIdsRef = useRef(new Set<string>())
  const [mainRef, mainSize] = useElementSize<HTMLElement>()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const {
    apiKeyStatus,
    canGenerate,
    error: modelsError,
    isLoading: isLoadingModels,
    loadModels,
    models,
    selectedModel,
    setSelectedModel,
    warnings: modelWarnings,
  } = useAvailableModels()
  const {
    activeSteps,
    cancelGeneration,
    error: generationError,
    failedJob,
    isGenerating,
    retryGeneration,
    resumeStoredJob,
    setError: setGenerationError,
    startGeneration,
    status: generationStatus,
  } = useGenerationJob({
    deckId,
    baseVersionId: activeVersionId,
    selectedModel,
    canGenerate,
    onReloadModels: loadModels,
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

  const parsedDeck = useMemo(() => {
    void thumbnailStylesRevision
    return parseDeckSlides(generatedHtml)
  }, [generatedHtml, thumbnailStylesRevision])
  const showSanitizedDownload = useMemo(
    () => deckHasExecutableContent(generatedHtml),
    [generatedHtml],
  )
  const hasSlides = parsedDeck.slideCount > 0
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
      disabled={isGenerating}
      error={assetError}
      onDismissUpload={dismissUpload}
      onRemoveAsset={removeAsset}
      onToggleSelected={toggleAssetSelected}
      onUploadFiles={uploadAssetFiles}
      selectedAssetIds={selectedAssetIds}
      uploads={assetUploads}
    />
  ) : null
  const chatDefaultSize = getChatPanelDefaultSize(mainSize.width)
  const deckDefaultSizeWithChat = getDeckPanelDefaultSizeWithChat(mainSize.width, chatDefaultSize)

  const applySucceededOutcome = useCallback(
    async (outcome: Extract<GenerationJobOutcome, { status: 'succeeded' }>) => {
      try {
        await refreshActiveDeck(outcome.job.result?.deckId)
      } catch {
        toast.error('Deck generated but could not be refreshed in the editor')
      }

      const targetDeckId = outcome.job.result?.deckId ?? deckId

      if (targetDeckId) {
        await reloadChat(targetDeckId)
      } else {
        const validationNote = outcome.job.result?.validation
          ? ` Validation: ${describeDeckValidation(outcome.job.result.validation as DeckValidationReport)}.`
          : ''
        const assistantParts = [
          ...outcome.assistantParts,
          ...(outcome.assistantContent
            ? [
                {
                  type: 'text' as const,
                  content: `${outcome.assistantContent}${validationNote}`,
                },
              ]
            : validationNote
              ? [{ type: 'text' as const, content: validationNote.trim() }]
              : []),
        ]

        setMessages((current) => [
          ...current,
          {
            id: newId(),
            role: 'assistant',
            content: outcome.assistantContent
              ? `${outcome.assistantContent}${validationNote}`
              : `Generated a complete self-contained HTML slide deck.${validationNote}`,
            parts: assistantParts.length > 0 ? assistantParts : undefined,
          },
        ])
      }

      toast.success(outcome.job.editingExistingDeck ? 'Deck updated' : 'Deck generated')
    },
    [deckId, refreshActiveDeck, reloadChat, setMessages],
  )

  useEffect(() => {
    if (isDeckLoading) {
      return
    }

    void (async () => {
      const outcome = await resumeStoredJob()

      if (!outcome) {
        return
      }

      if (outcome.status === 'succeeded') {
        if (recoveredJobIdsRef.current.has(outcome.job.id)) {
          return
        }

        recoveredJobIdsRef.current.add(outcome.job.id)
        await applySucceededOutcome(outcome)
        return
      }

      if (deckId) {
        await reloadChat(deckId)
      } else {
        setMessages((current) => {
          const failedContent =
            outcome.status === 'canceled'
              ? `Generation canceled. ${outcome.message}`
              : `I could not generate the deck yet. ${outcome.message}`
          const last = current.at(-1)

          if (last?.role === 'assistant' && last.content === failedContent) {
            return current
          }

          return [
            ...current,
            {
              id: newId(),
              role: 'assistant' as const,
              content: failedContent,
            },
          ]
        })
      }

      setError(outcome.message)
    })()
  }, [applySucceededOutcome, deckId, isDeckLoading, reloadChat, resumeStoredJob, setMessages])

  const generateDeck = async (rawPrompt: string, attachments: ChatAttachment[] = []) => {
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
    const allAttachments = [...selectedDeckAttachments, ...attachments]
    const prompt =
      rawPrompt.trim() ||
      (allAttachments.length > 0 ? 'Use the attached file(s) as reference for the deck.' : '')

    if (allAttachments.length > MAX_CHAT_ATTACHMENTS) {
      setAttachmentError(`You can attach up to ${MAX_CHAT_ATTACHMENTS} files per message.`)
      return
    }

    if ((!prompt && allAttachments.length === 0) || isGenerating || !canGenerate) {
      return
    }

    setError('')
    setGenerationError('')
    setAttachmentError('')
    const userMessage: ChatMessage = {
      id: newId(),
      role: 'user',
      content: rawPrompt.trim(),
      ...(allAttachments.length > 0 ? { attachments: allAttachments } : {}),
    }
    const nextMessages: ChatMessage[] = [...messages, userMessage]

    if (deckId) {
      await appendMessage(userMessage)
    } else {
      setMessages(nextMessages)
    }

    const assetIds = deckId ? selectedAssetIds : []

    try {
      const outcome = await startGeneration(nextMessages, generatedHtml, { assetIds })

      if (!outcome) {
        return
      }

      if (outcome.status === 'succeeded') {
        clearAssetSelection()
        await applySucceededOutcome(outcome)
        return
      }

      const message = outcome.message
      setError(message)

      if (deckId) {
        await reloadChat()
      } else {
        setMessages((current) => [
          ...current,
          {
            id: newId(),
            role: 'assistant',
            content:
              outcome.status === 'canceled'
                ? `Generation canceled. ${message}`
                : `I could not generate the deck yet. ${message}`,
          },
        ])
      }

      if (outcome.status === 'canceled') {
        toast.info('Generation canceled')
      } else if (outcome.job.error?.code === 'version_conflict') {
        toast.error('Deck changed during generation')
      } else {
        toast.error('Generation failed')
      }
    } catch (generationFailure) {
      const message =
        generationFailure instanceof Error
          ? generationFailure.message
          : 'Something went wrong while generating the deck.'

      setError(message)

      if (deckId) {
        await reloadChat()
      } else {
        setMessages((current) => [
          ...current,
          {
            id: newId(),
            role: 'assistant',
            content: `I could not generate the deck yet. ${message}`,
          },
        ])
      }
      toast.error('Generation failed')
    }
  }

  const handleCancelGeneration = async () => {
    try {
      await cancelGeneration()
      toast.info('Canceling generation…')
    } catch {
      toast.error('Could not cancel generation')
    }
  }

  const handleRetryGeneration = async () => {
    try {
      const outcome = await retryGeneration()

      if (!outcome) {
        return
      }

      if (outcome.status === 'succeeded') {
        await applySucceededOutcome(outcome)
        return
      }

      const message = outcome.message
      setError(message)

      if (deckId) {
        await reloadChat()
      }

      toast.error(outcome.status === 'canceled' ? 'Generation canceled' : 'Generation failed')
    } catch {
      toast.error('Could not retry generation')
    }
  }

  const handlePromptSubmit = async (message: PromptInputMessage) => {
    const attachments = toChatAttachments(message.files)
    const hasContent = Boolean(message.text.trim() || attachments.length > 0)

    if (!hasContent || !canGenerate) {
      return
    }

    setInput('')
    await generateDeck(message.text, attachments)
  }

  const handleRollbackVersion = async (versionId: string) => {
    try {
      await rollbackToVersion(versionId)
      await resetChat()
      setInput('')
      setError('')
      toast.success('Deck restored to selected version')
    } catch {
      toast.error('Could not restore that version')
      throw new Error('Could not restore that version')
    }
  }

  const handleDownload = (variant: DeckDownloadVariant = 'original') => {
    if (!generatedHtml) {
      return
    }

    downloadHtml(generatedHtml, { variant })
    toast.success(
      variant === 'sanitized' ? 'Sanitized HTML deck downloaded' : 'HTML deck downloaded',
    )
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleHtmlUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''

    if (!file) {
      return
    }

    if (!isHtmlDeckFile(file)) {
      toast.error('Upload an .html file')
      return
    }

    try {
      const html = await file.text()
      const validation = validateUploadedDeck(html)

      if (!validation.valid) {
        const primaryIssue = validation.issues.find((issue) => issue.severity === 'error')
        toast.error(primaryIssue?.message ?? 'That file does not look like a valid Ark HTML deck')
        return
      }

      let savedDeckId = deckId

      try {
        const savedDeck = await persistHtml(html, {
          source: 'upload',
          summary: `Uploaded ${file.name}`,
        })

        if (savedDeck?.id) {
          savedDeckId = savedDeck.id
        }
      } catch {
        toast.error('Deck loaded but could not be saved')
      }

      setError('')
      const uploadMessage: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: `Loaded ${file.name} into the preview. Validation: ${describeDeckValidation(validation)}. You can ask Ark to revise this HTML deck now.`,
      }

      if (savedDeckId) {
        await appendMessage(uploadMessage, savedDeckId)
      } else {
        setMessages((current) => [...current, uploadMessage])
      }
      toast.success('HTML deck loaded')
    } catch {
      toast.error('Could not read that HTML file')
    }
  }

  const handleNewDeck = () => {
    startNewDeck()
    void resetChat()
    setInput('')
    setError('')
    toast.info('Started a fresh deck')
  }

  const handleSelectDeck = async (nextDeckId: string) => {
    try {
      await selectDeck(nextDeckId)
      setInput('')
      setError('')
      toast.success('Deck loaded')
    } catch {
      toast.error('Could not load that deck')
    }
  }

  const handleRenameDeck = async (title: string) => {
    try {
      await renameActiveDeck(title)
      toast.success('Deck renamed')
    } catch (renameError) {
      toast.error('Could not rename deck')
      throw renameError
    }
  }

  const handleDeleteDeck = async () => {
    try {
      await deleteActiveDeck()
      await resetChat()
      setInput('')
      setError('')
      toast.success('Deck deleted')
    } catch {
      toast.error('Could not delete deck')
    }
  }

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

      try {
        await patchDeckOperations(
          [
            {
              op: 'replace_text',
              elementId: commit.elementId,
              slideIndex: commit.slideIndex,
              ...(commit.slideId ? { slideId: commit.slideId } : {}),
              text: commit.text,
            },
          ],
          commit.slideIndex,
          { summary: 'Edited text in preview' },
        )
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
    [deckId, patchDeckOperations, refreshActiveDeck],
  )

  const handlePatchEditorOperations = useCallback(
    async (operations: DeckElementPatchOperation[], activeSlideIndex: number, summary: string) => {
      if (!deckId) {
        toast.error('Save the deck before editing')
        throw new Error('Deck is not saved')
      }

      try {
        await patchDeckOperations(operations, activeSlideIndex, { summary })
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
    [deckId, patchDeckOperations, refreshActiveDeck],
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
            <ResizablePanelGroup
              className="min-h-0 overflow-hidden"
              key={isChatOpen ? `deck-with-chat-${String(chatDefaultSize)}` : 'deck-only'}
              orientation="horizontal"
            >
              <ResizablePanel
                defaultSize={isChatOpen ? deckDefaultSizeWithChat : '100%'}
                minSize={isChatOpen ? '45%' : '100%'}
              >
                <DeckPreview
                  deckId={deckId}
                  editorBridgeEnabled
                  html={generatedHtml}
                  isGenerating={isGenerating}
                  isStripOpen={isStripOpen}
                  isTextEditSaving={isDeckPatching}
                  layout="desktop"
                  onCommitTextEdit={handleCommitTextEdit}
                  onPatchEditorOperations={handlePatchEditorOperations}
                  parsedDeck={parsedDeck}
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
                    <ChatPanel
                      activeSteps={activeSteps}
                      apiKeyStatus={apiKeyStatus}
                      assetsSlot={deckAssetsSlot}
                      attachmentError={attachmentError}
                      canGenerate={canGenerate}
                      error={displayError}
                      failedJobId={failedJob?.id ?? null}
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
                      onPromptSubmit={handlePromptSubmit}
                      onRefreshModels={loadModels}
                      onRetryGeneration={handleRetryGeneration}
                      onRetryPersist={retryPersist}
                      selectedModel={selectedModel}
                    />
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
                  deckId={deckId}
                  editorBridgeEnabled
                  html={generatedHtml}
                  isGenerating={isGenerating}
                  isStripOpen={isStripOpen}
                  isTextEditSaving={isDeckPatching}
                  layout="mobile"
                  onCommitTextEdit={handleCommitTextEdit}
                  parsedDeck={parsedDeck}
                  versionId={activeVersionId}
                />
              </div>
              {isChatOpen ? (
                <div className="min-h-0 overflow-hidden" id="ark-chat-panel">
                  <ChatPanel
                    activeSteps={activeSteps}
                    apiKeyStatus={apiKeyStatus}
                    assetsSlot={deckAssetsSlot}
                    attachmentError={attachmentError}
                    canGenerate={canGenerate}
                    error={displayError}
                    failedJobId={failedJob?.id ?? null}
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
                    onPromptSubmit={handlePromptSubmit}
                    onRefreshModels={loadModels}
                    onRetryGeneration={handleRetryGeneration}
                    onRetryPersist={retryPersist}
                    selectedModel={selectedModel}
                  />
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
