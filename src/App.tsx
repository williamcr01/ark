import { useMemo, useRef, useState, type ChangeEvent } from 'react'

import { toApiMessages } from '../shared/chat.ts'
import { toast } from 'sonner'

import { AppTitleBar } from '@/components/AppTitleBar'
import {
  ChatPanel,
  type ChatMessage,
} from '@/components/ChatPanel'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import { DeckPreview } from '@/components/DeckPreview'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAvailableModels } from '@/hooks/useAvailableModels'
import { useDeckSession } from '@/hooks/useDeckSession'
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
  error?: string
  code?: 'missing_api_key' | 'invalid_api_key' | 'provider_error'
  validation?: DeckValidationReport
}

function App() {
  const {
    html: generatedHtml,
    messages,
    resetSession,
    setHtml: setGeneratedHtml,
    setMessages,
  } = useDeckSession()
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(true)
  const [isStripOpen, setIsStripOpen] = useState(true)
  const [error, setError] = useState('')
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

  const hasDeck = generatedHtml.length > 0
  const parsedDeck = useMemo(() => parseDeckSlides(generatedHtml), [generatedHtml])
  const hasSlides = parsedDeck.slideCount > 0
  const chatDefaultSize = getChatPanelDefaultSize(mainSize.width)
  const deckDefaultSizeWithChat = getDeckPanelDefaultSizeWithChat(
    mainSize.width,
    chatDefaultSize,
  )

  const generateDeck = async (rawPrompt: string) => {
    const prompt = rawPrompt.trim()

    if (!prompt || isGenerating || !canGenerate) {
      return
    }

    const editingExistingDeck = hasDeck
    setError('')
    setIsGenerating(true)
    const nextMessages: ChatMessage[] = [
      ...messages,
      { id: newId(), role: 'user', content: prompt },
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

      setGeneratedHtml(data.html)
      const validationNote = data.validation
        ? ` Validation: ${describeDeckValidation(data.validation)}.`
        : ''
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: editingExistingDeck
            ? `Updated the HTML deck and refreshed the preview.${validationNote} You can keep iterating from here or download the file.`
            : `Generated a complete self-contained HTML slide deck.${validationNote} Review the preview, then ask for edits or download the file.`,
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
    if (!message.text.trim() || !canGenerate) {
      return
    }

    setInput('')
    await generateDeck(message.text)
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

      setGeneratedHtml(html)
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

  const handleReset = () => {
    resetSession()
    setInput('')
    setError('')
    toast.info('Started a fresh deck')
  }

  return (
    <TooltipProvider>
      <div className="flex h-svh min-h-0 flex-col bg-[var(--ark-canvas)] text-foreground">
        <AppTitleBar
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
              key={
                isChatOpen
                  ? `deck-with-chat-${String(chatDefaultSize)}`
                  : 'deck-only'
              }
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
                      canGenerate={canGenerate}
                      error={error}
                      input={input}
                      isGenerating={isGenerating}
                      isLoadingModels={isLoadingModels}
                      messages={messages}
                      models={models}
                      modelsError={modelsError}
                      modelWarnings={modelWarnings}
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
                    canGenerate={canGenerate}
                    error={error}
                    input={input}
                    isGenerating={isGenerating}
                    isLoadingModels={isLoadingModels}
                    messages={messages}
                    models={models}
                    modelsError={modelsError}
                    modelWarnings={modelWarnings}
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
