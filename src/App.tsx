import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import {
  AlertCircleIcon,
  DownloadIcon,
  FileCode2Icon,
  Loader2Icon,
  MonitorPlayIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PresentationIcon,
  RefreshCwIcon,
  UploadIcon,
  SparklesIcon,
  WandSparklesIcon,
} from 'lucide-react'

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type GenerateResponse = {
  html?: string
  error?: string
}

const newId = () => crypto.randomUUID()

function downloadHtml(html: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `ark-presentation-${new Date().toISOString().slice(0, 10)}.html`
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const PREVIEW_FRAME_WIDTH = 1600
const PREVIEW_FRAME_HEIGHT = 900
const PREVIEW_FRAME_ASPECT_RATIO = `${PREVIEW_FRAME_WIDTH} / ${PREVIEW_FRAME_HEIGHT}`

type ElementSize = {
  width: number
  height: number
}

function useElementSize<T extends HTMLElement>() {
  const elementRef = useRef<T>(null)
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })

  useEffect(() => {
    const element = elementRef.current

    if (!element) {
      return
    }

    const updateSize = () => {
      const { width, height } = element.getBoundingClientRect()

      setSize((current) => {
        if (
          Math.abs(current.width - width) < 0.5 &&
          Math.abs(current.height - height) < 0.5
        ) {
          return current
        }

        return { width, height }
      })
    }

    updateSize()

    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(element)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  return [elementRef, size] as const
}

function getPreviewFrameScale({ width, height }: ElementSize) {
  const scale = Math.min(width / PREVIEW_FRAME_WIDTH, height / PREVIEW_FRAME_HEIGHT)

  if (!Number.isFinite(scale) || scale <= 0) {
    return 0
  }

  return scale
}

function getPreviewStageStyle(scale: number): CSSProperties {
  if (scale <= 0) {
    return {
      aspectRatio: PREVIEW_FRAME_ASPECT_RATIO,
      width: '100%',
      maxHeight: '100%',
    }
  }

  return {
    width: PREVIEW_FRAME_WIDTH * scale,
    height: PREVIEW_FRAME_HEIGHT * scale,
  }
}

function getPreviewFrameStyle(scale: number): CSSProperties {
  return {
    width: PREVIEW_FRAME_WIDTH,
    height: PREVIEW_FRAME_HEIGHT,
    transform: `scale(${scale || 1})`,
    transformOrigin: 'top left',
    visibility: scale > 0 ? 'visible' : 'hidden',
  }
}

const previewFillStyle = `
<style data-ark-preview-fill>
  html,
  body {
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

</style>`

function getPreviewHtml(html: string) {
  if (!html) {
    return ''
  }

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${previewFillStyle}\n</head>`)
  }

  return `${previewFillStyle}\n${html}`
}

type TitleBarButtonProps = {
  active?: boolean
  children: ReactNode
  disabled?: boolean
  label: string
  onClick?: () => void
  primary?: boolean
} & Pick<
  React.ComponentProps<'button'>,
  'aria-controls' | 'aria-expanded' | 'type'
>

function TitleBarButton({
  active = false,
  children,
  disabled,
  label,
  onClick,
  primary = false,
  ...props
}: TitleBarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-pressed={active}
          className={cn(
            buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
            'size-[26px] rounded-sm border-0 text-[var(--ark-titlebar-fg)] shadow-none',
            'hover:bg-[var(--ark-titlebar-hover)]',
            'disabled:text-[var(--ark-titlebar-muted)]/50',
            active && 'bg-[var(--ark-titlebar-active)]',
            primary &&
            !disabled &&
            'text-[var(--ark-accent)] hover:bg-[var(--ark-accent-soft)]',
          )}
          disabled={disabled}
          onClick={onClick}
          type="button"
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function App() {
  const [generatedHtml, setGeneratedHtml] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(true)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasDeck = generatedHtml.length > 0

  const generateDeck = async (rawPrompt: string) => {
    const prompt = rawPrompt.trim()

    if (!prompt || isGenerating) {
      return
    }

    const editingExistingDeck = hasDeck
    setError('')
    setIsGenerating(true)
    setMessages((current) => [
      ...current,
      { id: newId(), role: 'user', content: prompt },
    ])

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currentHtml: generatedHtml || null,
        }),
      })

      const data = (await response.json().catch(() => ({
        error: 'The API returned an unreadable response.',
      }))) as GenerateResponse

      if (!response.ok || !data.html) {
        throw new Error(data.error ?? 'The deck could not be generated.')
      }

      setGeneratedHtml(data.html)
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: editingExistingDeck
            ? 'Updated the HTML deck and refreshed the preview. You can keep iterating from here or download the file.'
            : 'Generated a complete self-contained HTML slide deck. Review the preview, then ask for edits or download the file.',
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
    if (!message.text.trim()) {
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

    const looksLikeHtmlFile =
      file.type === 'text/html' ||
      file.name.toLowerCase().endsWith('.html') ||
      file.name.toLowerCase().endsWith('.htm')

    if (!looksLikeHtmlFile) {
      toast.error('Upload an .html file')
      return
    }

    try {
      const html = await file.text()

      if (!/<html[\s>]/i.test(html) || !/<body[\s>]/i.test(html)) {
        toast.error('That file does not look like a complete HTML deck')
        return
      }

      setGeneratedHtml(html)
      setError('')
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: 'assistant',
          content: `Loaded ${file.name} into the preview. You can ask Ark to revise this HTML deck now.`,
        },
      ])
      toast.success('HTML deck loaded')
    } catch {
      toast.error('Could not read that HTML file')
    }
  }

  const handleReset = () => {
    setGeneratedHtml('')
    setMessages([])
    setInput('')
    setError('')
    toast.info('Started a fresh deck')
  }

  return (
    <TooltipProvider>
      <div className="flex h-svh min-h-0 flex-col bg-[var(--ark-canvas)] text-foreground">
        <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)] px-2 text-[var(--ark-titlebar-fg)]">
          <input
            accept=".html,.htm,text/html"
            className="hidden"
            onChange={handleHtmlUpload}
            ref={fileInputRef}
            type="file"
          />
          <div className="flex min-w-0 items-center gap-2 px-1">
            <PresentationIcon
              aria-hidden
              className="size-4 shrink-0 text-[var(--ark-titlebar-muted)]"
            />
            <span className="truncate text-[13px] leading-none">Ark</span>
            <span
              aria-hidden
              className="text-[var(--ark-titlebar-muted)]"
            >
              ·
            </span>
            <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-[var(--ark-titlebar-muted)]">
              <span
                aria-hidden
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  isGenerating
                    ? 'animate-pulse bg-amber-500'
                    : hasDeck
                      ? 'bg-emerald-500'
                      : 'bg-[var(--ark-titlebar-muted)]/50',
                )}
              />
              {isGenerating ? 'Generating…' : hasDeck ? 'Deck ready' : 'New deck'}
            </span>
          </div>

          <div className="min-w-0 flex-1" aria-hidden />

          <ButtonGroup className="shrink-0">
            <TitleBarButton
              disabled={!hasDeck || isGenerating}
              label="Start over"
              onClick={handleReset}
            >
              <RefreshCwIcon />
            </TitleBarButton>
            <TitleBarButton
              disabled={!hasDeck}
              label="Download HTML"
              onClick={handleDownload}
              primary
            >
              <DownloadIcon />
            </TitleBarButton>
            <TitleBarButton
              disabled={isGenerating}
              label="Upload HTML"
              onClick={handleUploadClick}
            >
              <UploadIcon />
            </TitleBarButton>
            <ButtonGroupSeparator className="mx-0.5 h-4 bg-[var(--ark-titlebar-border)]" />
            <TitleBarButton
              active={isChatOpen}
              aria-controls="ark-chat-panel-desktop ark-chat-panel-mobile"
              aria-expanded={isChatOpen}
              label={isChatOpen ? 'Hide chat panel' : 'Show chat panel'}
              onClick={() => setIsChatOpen((current) => !current)}
            >
              {isChatOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
            </TitleBarButton>
          </ButtonGroup>
        </header>

        <main className="hidden min-h-0 flex-1 lg:block">
          <ResizablePanelGroup
            className="min-h-0 overflow-hidden"
            key={isChatOpen ? 'deck-with-chat' : 'deck-only'}
            orientation="horizontal"
          >
            <ResizablePanel
              defaultSize={isChatOpen ? 72 : 100}
              minSize={isChatOpen ? 55 : 100}
            >
              <DeckPreview html={generatedHtml} isGenerating={isGenerating} />
            </ResizablePanel>
            {isChatOpen ? (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={28} id="ark-chat-panel-desktop" minSize={24}>
                  <ChatPanel
                    error={error}
                    input={input}
                    isGenerating={isGenerating}
                    messages={messages}
                    onInputChange={setInput}
                    onPromptSubmit={handlePromptSubmit}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </main>

        <main
          className={
            isChatOpen
              ? 'grid min-h-0 flex-1 grid-rows-[minmax(320px,0.9fr)_minmax(420px,1fr)] lg:hidden'
              : 'grid min-h-0 flex-1 lg:hidden'
          }
        >
          <div className="min-h-0 overflow-hidden">
            <DeckPreview html={generatedHtml} isGenerating={isGenerating} />
          </div>
          {isChatOpen ? (
            <div className="min-h-0 overflow-hidden" id="ark-chat-panel-mobile">
              <ChatPanel
                error={error}
                input={input}
                isGenerating={isGenerating}
                messages={messages}
                onInputChange={setInput}
                onPromptSubmit={handlePromptSubmit}
              />
            </div>
          ) : null}
        </main>
      </div>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}

type DeckPreviewProps = {
  html: string
  isGenerating: boolean
}

function DeckPreview({ html, isGenerating }: DeckPreviewProps) {
  const [previewViewportRef, previewViewportSize] = useElementSize<HTMLDivElement>()
  const previewFrameScale = getPreviewFrameScale(previewViewportSize)
  const previewStageStyle = getPreviewStageStyle(previewFrameScale)
  const previewFrameStyle = getPreviewFrameStyle(previewFrameScale)

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
            HTML deck
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--ark-titlebar-muted)]">
          <FileCode2Icon className="size-3" />
          srcDoc
        </span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden"
          ref={previewViewportRef}
        >
          {html ? (
            <div
              className="relative max-h-full max-w-full overflow-hidden bg-white shadow-2xl shadow-slate-950/10 ring-1 ring-[var(--ark-stage-border)]"
              style={previewStageStyle}
            >
              <iframe
                className="absolute left-0 top-0 block border-0 bg-white"
                referrerPolicy="no-referrer"
                sandbox="allow-scripts"
                srcDoc={getPreviewHtml(html)}
                style={previewFrameStyle}
                title="Generated Ark presentation preview"
              />
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
            Ask Ark for a pitch deck, strategy update, sales proposal, research summary, or any presentation you need.
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

type ChatPanelProps = {
  messages: ChatMessage[]
  input: string
  isGenerating: boolean
  error: string
  onInputChange: (value: string) => void
  onPromptSubmit: (message: PromptInputMessage) => Promise<void>
}

function ChatPanel({
  messages,
  input,
  isGenerating,
  error,
  onInputChange,
  onPromptSubmit,
}: ChatPanelProps) {
  return (
    <Card className="flex h-full min-h-0 gap-0 rounded-none border-0 py-0 shadow-none ring-0 [--card-spacing:0]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)] px-3">
        <div className="flex min-w-0 items-center gap-2 text-[var(--ark-titlebar-fg)]">
          <SparklesIcon
            aria-hidden
            className="size-3.5 shrink-0 text-[var(--ark-accent)]"
          />
          <span className="truncate text-xs font-medium">Chat</span>
          <span aria-hidden className="text-[var(--ark-titlebar-muted)]">
            ›
          </span>
          <span className="truncate text-xs text-[var(--ark-titlebar-muted)]">
            AI agent
          </span>
        </div>
      </div>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <Conversation>
          <ConversationContent className="gap-5 px-5 py-6">
            {messages.length === 0 ? (
              <ConversationEmptyState
                description="Paste notes, describe an audience, or ask for a specific deck structure. Ark will return a complete HTML presentation."
                icon={<SparklesIcon className="size-10" />}
                title="Tell Ark what to make"
              />
            ) : (
              messages.map((message) => (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    <MessageResponse>{message.content}</MessageResponse>
                  </MessageContent>
                </Message>
              ))
            )}
            {isGenerating ? (
              <Message from="assistant">
                <MessageContent>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    Designing the deck, writing HTML, and preparing the preview…
                  </div>
                </MessageContent>
              </Message>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="shrink-0 border-t bg-white p-4">
          {error ? (
            <Alert className="mb-3" variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Generation failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <PromptInput onSubmit={onPromptSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                className="min-h-24 resize-none"
                disabled={isGenerating}
                onChange={(event) => onInputChange(event.currentTarget.value)}
                placeholder="Describe the deck you want, or ask for an edit…"
                value={input}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span>Enter to send</span>
                <Separator className="h-3" orientation="vertical" />
                <span>Shift + Enter for a new line</span>
              </div>
              <PromptInputSubmit
                disabled={!input.trim() || isGenerating}
                status={isGenerating ? 'submitted' : 'ready'}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </CardContent>
    </Card>
  )
}

export default App
