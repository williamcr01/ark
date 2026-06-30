import { useMemo, useRef, useState, type ChangeEvent } from 'react'

import {
  agentStepsToChatParts,
  buildAssistantMessageContent,
  toApiMessages,
  toChatAttachments,
  type AgentStep,
  type ChatAttachment,
} from '../shared/chat.ts'
import { toast } from 'sonner'

import { AppTitleBar, type DeckSaveStatus } from '@/components/AppTitleBar'
import { ChatPanel, type ChatMessage } from '@/components/ChatPanel'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import { DeckPreview } from '@/components/DeckPreview'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAvailableModels } from '@/hooks/useAvailableModels'
import { useChatSession } from '@/hooks/useChatSession'
import { useDeckPersistence } from '@/hooks/useDeckPersistence'
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
import { parseDeckSlides } from '@/lib/deck-slides'
import type { DeckValidationReport } from '@/lib/deck-validate'
import { newId } from '@/lib/id'

type GenerateResponse = {
  html?: string
  text?: string
  steps?: AgentStep[]
  error?: string
  code?: 'missing_api_key' | 'invalid_api_key' | 'provider_error'
  validation?: DeckValidationReport
}

function App() {
  const {
    hasDeck,
    html: generatedHtml,
    isDirty,
    isLoading: isDeckLoading,
    isSaving: isDeckSaving,
    persistHtml,
    resetDeck,
    saveError,
  } = useDeckPersistence()
  const { messages, resetChat, setMessages } = useChatSession()
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(true)
  const [isStripOpen, setIsStripOpen] = useState(true)
  const [error, setError] = useState('')
  const [attachmentError, setAttachmentError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  const parsedDeck = useMemo(() => parseDeckSlides(generatedHtml), [generatedHtml])
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
  const chatDefaultSize = getChatPanelDefaultSize(mainSize.width)
  const deckDefaultSizeWithChat = getDeckPanelDefaultSizeWithChat(mainSize.width, chatDefaultSize)

  const generateDeck = async (rawPrompt: string, attachments: ChatAttachment[] = []) => {
    const prompt =
      rawPrompt.trim() ||
      (attachments.length > 0 ? 'Use the attached file(s) as reference for the deck.' : '')

    if ((!prompt && attachments.length === 0) || isGenerating || !canGenerate) {
      return
    }

    const editingExistingDeck = hasDeck
    setError('')
    setAttachmentError('')
    setIsGenerating(true)
    const nextMessages: ChatMessage[] = [
      ...messages,
      {
        id: newId(),
        role: 'user',
        content: rawPrompt.trim(),
        ...(attachments.length > 0 ? { attachments } : {}),
      },
    ]
    setMessages(nextMessages)

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: toApiMessages(nextMessages),
          currentHtml: generatedHtml || null,
          model: selectedModel || undefined,
        }),
      })

      const data = (await response.json().catch(() => ({
        error: 'The API returned an unreadable response.',
      }))) as GenerateResponse

      if (!response.ok || !data.html) {
        if (data.code === 'missing_api_key' || data.code === 'invalid_api_key') {
          void loadModels()
        }

        throw new Error(data.error ?? 'The deck could not be generated.')
      }

      try {
        await persistHtml(data.html)
      } catch {
        toast.error('Deck generated but could not be saved')
      }

      const validationNote = data.validation
        ? ` Validation: ${describeDeckValidation(data.validation)}.`
        : ''
      const assistantContent = buildAssistantMessageContent(
        data.text ?? '',
        data.steps ?? [],
        editingExistingDeck,
      )
      const assistantParts = [
        ...(data.steps?.length ? agentStepsToChatParts(data.steps) : []),
        ...(assistantContent
          ? [{ type: 'text' as const, content: `${assistantContent}${validationNote}` }]
          : validationNote
            ? [{ type: 'text' as const, content: validationNote.trim() }]
            : []),
      ]

      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: assistantContent
            ? `${assistantContent}${validationNote}`
            : editingExistingDeck
              ? `Updated the HTML deck and refreshed the preview.${validationNote}`
              : `Generated a complete self-contained HTML slide deck.${validationNote}`,
          parts: assistantParts.length > 0 ? assistantParts : undefined,
        },
      ])
      toast.success(editingExistingDeck ? 'Deck updated' : 'Deck generated')
    } catch (generationError) {
      const message =
        generationError instanceof Error
          ? generationError.message
          : 'Something went wrong while generating the deck.'

      setError(message)
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: `I could not generate the deck yet. ${message}`,
        },
      ])
      toast.error('Generation failed')
    } finally {
      setIsGenerating(false)
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

  const handleDownload = () => {
    if (!generatedHtml) {
      return
    }

    downloadHtml(generatedHtml)
    toast.success('HTML deck downloaded')
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

      try {
        await persistHtml(html)
      } catch {
        toast.error('Deck loaded but could not be saved')
      }

      setError('')
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: `Loaded ${file.name} into the preview. Validation: ${describeDeckValidation(validation)}. You can ask Ark to revise this HTML deck now.`,
        },
      ])
      toast.success('HTML deck loaded')
    } catch {
      toast.error('Could not read that HTML file')
    }
  }

  const handleReset = async () => {
    await resetDeck()
    resetChat()
    setInput('')
    setError('')
    toast.info('Started a fresh deck')
  }

  return (
    <TooltipProvider>
      <div className="flex h-svh min-h-0 flex-col bg-[var(--ark-canvas)] text-foreground">
        <AppTitleBar
          deckSaveStatus={deckSaveStatus}
          fileInputRef={fileInputRef}
          hasDeck={hasDeck}
          hasSlides={hasSlides}
          isChatOpen={isChatOpen}
          isGenerating={isGenerating}
          isStripOpen={isStripOpen}
          onDownload={handleDownload}
          onHtmlUpload={handleHtmlUpload}
          onReset={handleReset}
          onToggleChat={() => setIsChatOpen((current) => !current)}
          onToggleStrip={() => setIsStripOpen((current) => !current)}
          onUploadClick={handleUploadClick}
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
                  html={generatedHtml}
                  isGenerating={isGenerating}
                  isStripOpen={isStripOpen}
                  layout="desktop"
                  parsedDeck={parsedDeck}
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
                      apiKeyStatus={apiKeyStatus}
                      attachmentError={attachmentError}
                      canGenerate={canGenerate}
                      error={error}
                      input={input}
                      isGenerating={isGenerating}
                      isLoadingModels={isLoadingModels}
                      messages={messages}
                      models={models}
                      modelsError={modelsError}
                      modelWarnings={modelWarnings}
                      onAttachmentError={setAttachmentError}
                      onInputChange={setInput}
                      onModelChange={setSelectedModel}
                      onPromptSubmit={handlePromptSubmit}
                      onRefreshModels={loadModels}
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
                  html={generatedHtml}
                  isGenerating={isGenerating}
                  isStripOpen={isStripOpen}
                  layout="mobile"
                  parsedDeck={parsedDeck}
                />
              </div>
              {isChatOpen ? (
                <div className="min-h-0 overflow-hidden" id="ark-chat-panel">
                  <ChatPanel
                    apiKeyStatus={apiKeyStatus}
                    attachmentError={attachmentError}
                    canGenerate={canGenerate}
                    error={error}
                    input={input}
                    isGenerating={isGenerating}
                    isLoadingModels={isLoadingModels}
                    messages={messages}
                    models={models}
                    modelsError={modelsError}
                    modelWarnings={modelWarnings}
                    onAttachmentError={setAttachmentError}
                    onInputChange={setInput}
                    onModelChange={setSelectedModel}
                    onPromptSubmit={handlePromptSubmit}
                    onRefreshModels={loadModels}
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
