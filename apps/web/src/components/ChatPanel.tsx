import {
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
  useState,
} from 'react'
import type { BorderBeamProps } from 'border-beam'
import {
  AlertCircleIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react'

import { AgentPresence } from '@/components/AgentPresence'
import { AgentQuestions } from '@/components/AgentQuestions'
import { ThemePicker } from '@/components/ThemePicker'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPresence,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { ContextChipList } from '@/components/ChatContextChips'
import { contextToChipProps } from '@/lib/chat-context-chips'
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import { ModelSelector } from '@/components/ModelSelector'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  MorphMenuContent,
  MorphMenuFooter,
  morphMenuTriggerClassName,
} from '@/components/ui/morph-menu'
import type { ResolvedAppearance } from '@/hooks/useAppearance'
import { type AvailableModel } from '@/hooks/useAvailableModels'
import type { ReasoningEffort } from '@/hooks/useReasoningEffort'
import type { MessageDeliveryStatus } from '@/hooks/useChatSession'
import type {
  AgentStep,
  ChatAttachment,
  ChatMessage,
  ChatMessagePart,
} from '@ark/deck-core/chat.ts'
import { agentStepsToChatParts, MAX_CHAT_ATTACHMENT_BYTES } from '@ark/deck-core/chat.ts'
import {
  agentQuestionRequestSchema,
  formatAgentQuestionAnswers,
  parseAgentQuestionAnswerLines,
  type AgentQuestionRequest,
} from '@ark/deck-core/agent-questions.ts'
import {
  formatThemeChoice,
  parseThemeChoiceName,
  themeProposalRequestSchema,
  type ThemeProposalRequest,
} from '@ark/deck-core/agent-themes.ts'
import type { GenerationJobStatus } from '@ark/deck-core/generation-job.ts'
import {
  findAskUserAnswerAfter,
  findPendingAgentQuestions,
  isAskUserAnswerMessage,
} from '@/lib/agent-questions'
import {
  findPendingThemeProposal,
  findThemeChoiceAfter,
  isThemeChoiceMessage,
} from '@/lib/agent-themes'
import { cn } from '@/lib/utils'

const BorderBeam = lazy(() => import('border-beam')) as LazyExoticComponent<
  ComponentType<BorderBeamProps>
>

export type { ChatMessage } from '@ark/deck-core/chat.ts'

type ChatAlertId = 'generation' | 'attachment' | 'models' | 'model-warnings'

function ChatFloatingAlert({
  title,
  variant = 'default',
  onClose,
  children,
}: {
  title: string
  variant?: 'default' | 'destructive'
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Alert variant={variant}>
      <AlertCircleIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
      <AlertAction>
        <Button aria-label={`Dismiss ${title}`} onClick={onClose} size="icon-xs" variant="ghost">
          <XIcon />
        </Button>
      </AlertAction>
    </Alert>
  )
}

function ActiveComposer({
  active,
  reducedMotion,
  resolvedAppearance,
  children,
}: {
  active: boolean
  reducedMotion: boolean
  resolvedAppearance: ResolvedAppearance
  children: ReactNode
}) {
  const ringClassName = cn(active && 'rounded-lg ring-1 ring-[var(--ark-focus)]')

  // Keep a stable wrapper tree so toggling generation does not remount PromptInput.
  if (reducedMotion) {
    return <div className={ringClassName}>{children}</div>
  }

  return (
    <Suspense fallback={<div className={ringClassName}>{children}</div>}>
      <BorderBeam
        active={active}
        className={ringClassName}
        colorVariant="mono"
        duration={3.1}
        size="line"
        staticColors
        strength={1}
        theme={resolvedAppearance}
      >
        {children}
      </BorderBeam>
    </Suspense>
  )
}

function alertDismissKey(alertId: ChatAlertId, content: string) {
  return `${alertId}:${content}`
}

function formatAttachmentError(error: { code: string; message: string }) {
  switch (error.code) {
    case 'max_file_size':
      return `Each attachment must be ${Math.round(MAX_CHAT_ATTACHMENT_BYTES / (1024 * 1024))} MB or smaller.`
    default:
      return error.message
  }
}

function ChatMessageAttachments({ attachments }: { attachments: ChatAttachment[] }) {
  if (attachments.length === 0) {
    return null
  }

  return (
    <Attachments className="mt-2" variant="inline">
      {attachments.map((attachment, index) => (
        <Attachment
          data={{
            ...attachment,
            id: `${attachment.filename ?? 'attachment'}-${index}`,
          }}
          key={`${attachment.filename ?? 'attachment'}-${index}`}
        >
          <AttachmentPreview />
          <AttachmentInfo />
        </Attachment>
      ))}
    </Attachments>
  )
}

function PromptInputAttachmentsDisplay({ children }: { children?: ReactNode }) {
  const attachments = usePromptInputAttachments()
  const hasFiles = attachments.files.length > 0

  if (!hasFiles && !children) {
    return null
  }

  return (
    <PromptInputHeader>
      <Attachments variant="inline">
        <AttachmentPresence>
          {attachments.files.map((attachment) => (
            <Attachment
              data={attachment}
              key={attachment.id}
              onRemove={() => attachments.remove(attachment.id)}
            >
              <AttachmentPreview />
              <AttachmentInfo />
              <AttachmentRemove />
            </Attachment>
          ))}
        </AttachmentPresence>
        {children}
      </Attachments>
    </PromptInputHeader>
  )
}

function ChatPromptInputSubmit({
  input,
  isGenerating,
  isInputDisabled,
  onCancelGeneration,
}: {
  input: string
  isGenerating: boolean
  isInputDisabled: boolean
  onCancelGeneration: () => void | Promise<void>
}) {
  const attachments = usePromptInputAttachments()
  const canSubmit = Boolean(input.trim() || attachments.files.length > 0)

  return (
    <PromptInputSubmit
      className="ark-control-invert! size-8 shrink-0 rounded-full"
      disabled={!isGenerating && (!canSubmit || isInputDisabled)}
      onStop={() => {
        void onCancelGeneration()
      }}
      status={isGenerating ? 'streaming' : 'ready'}
    />
  )
}

function formatToolLabel(toolName: string) {
  return toolName.replace(/_/g, ' ')
}

type IndexedToolPart = {
  index: number
  part: Extract<ChatMessagePart, { type: 'tool-call' | 'tool-result' }>
}

type ChatPartSegment =
  | { type: 'part'; index: number; part: ChatMessagePart }
  | { type: 'tools'; parts: IndexedToolPart[] }

function segmentChatParts(parts: ChatMessagePart[]) {
  const segments: ChatPartSegment[] = []

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part.type !== 'tool-call' && part.type !== 'tool-result') {
      segments.push({ type: 'part', index, part })
      continue
    }

    const run: IndexedToolPart[] = []
    while (index < parts.length) {
      const toolPart = parts[index]
      if (toolPart.type !== 'tool-call' && toolPart.type !== 'tool-result') break
      run.push({ index, part: toolPart })
      index += 1
    }
    index -= 1

    segments.push({ type: 'tools', parts: run })
  }

  return segments
}

function ToolActivityLine({ part }: { part: IndexedToolPart['part'] }) {
  const error = part.type === 'tool-result' && part.error

  return (
    <div
      className={cn(
        'text-xs leading-relaxed',
        error ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      <span className={cn('font-medium', !error && 'text-foreground')}>
        {formatToolLabel(part.toolName)}
      </span>
      {part.summary ? <span> — {part.summary}</span> : null}
    </div>
  )
}

function AskUserTranscript({
  request,
  answersContent,
}: {
  request: AgentQuestionRequest
  answersContent?: string | null
}) {
  const count = request.questions.length
  const answered = Boolean(answersContent)
  const answers = answersContent ? parseAgentQuestionAnswerLines(request, answersContent) : null

  return (
    <details className="text-xs" open={answered}>
      <summary className="cursor-pointer select-none font-medium text-muted-foreground">
        {answered
          ? `Answered ${count} question${count === 1 ? '' : 's'}`
          : `Asked ${count} question${count === 1 ? '' : 's'}`}
      </summary>
      {answered && answers ? (
        <div className="mt-1.5 flex flex-col gap-2 pl-4">
          {request.title ? (
            <p className="text-muted-foreground/80 text-[11px]">{request.title}</p>
          ) : null}
          {request.questions.map((question) => (
            <div className="flex flex-col gap-0.5" key={question.id}>
              <p className="text-foreground font-medium">{question.question}</p>
              <p className="text-muted-foreground">{answers[question.id] ?? 'No answer'}</p>
            </div>
          ))}
        </div>
      ) : null}
    </details>
  )
}

function ThemeProposalTranscript({
  request,
  choiceContent,
}: {
  request: ThemeProposalRequest
  choiceContent?: string | null
}) {
  const chosenName = choiceContent ? parseThemeChoiceName(request, choiceContent) : null
  const answered = Boolean(chosenName)

  return (
    <details className="text-xs" open={answered}>
      <summary className="cursor-pointer select-none font-medium text-muted-foreground">
        {answered ? `Chose theme: ${chosenName}` : `Proposed ${request.themes.length} themes`}
      </summary>
      {answered ? (
        <div className="mt-1.5 flex flex-col gap-1.5 pl-4">
          {request.title ? (
            <p className="text-muted-foreground/80 text-[11px]">{request.title}</p>
          ) : null}
          <ul className="flex flex-col gap-0.5 text-muted-foreground">
            {request.themes.map((theme) => (
              <li
                className={cn(theme.name === chosenName && 'font-medium text-foreground')}
                key={theme.id}
              >
                {theme.name}
                {theme.name === chosenName ? ' (selected)' : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  )
}

function ChatMessageDeliveryStatus({
  status,
  onRetry,
}: {
  status: MessageDeliveryStatus | undefined
  onRetry?: () => void
}) {
  if (!status || status === 'saved') {
    return null
  }

  if (status === 'saving') {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2Icon aria-hidden className="size-3 animate-spin" />
        <span>Saving to server…</span>
      </div>
    )
  }

  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-destructive">
      <AlertCircleIcon aria-hidden className="size-3.5 shrink-0" />
      <span>Not saved to server</span>
      {onRetry ? (
        <button
          className="inline-flex items-center gap-1 rounded-sm font-medium text-destructive underline-offset-2 hover:underline"
          onClick={onRetry}
          type="button"
        >
          <RefreshCwIcon aria-hidden className="size-3" />
          Retry
        </button>
      ) : null}
    </div>
  )
}

function formatThinkingSummaryLabel(durationMs: number | undefined, live: boolean) {
  if (durationMs === undefined) {
    // Live in-progress flushes omit durationMs; finished history without a
    // recorded duration (older chats) falls back to a past-tense label.
    return live ? 'Thinking' : 'Thought'
  }

  const seconds = Math.max(1, Math.round(durationMs / 1000))
  return seconds === 1 ? 'Thought for 1 second' : `Thought for ${seconds} seconds`
}

function isInteractiveToolPart(part: ChatMessagePart, toolName: string) {
  return (part.type === 'tool-call' || part.type === 'tool-result') && part.toolName === toolName
}

function ChatMessageParts({
  parts,
  live = false,
  askUserAnswers = null,
  themeChoice = null,
}: {
  parts: ChatMessagePart[]
  live?: boolean
  askUserAnswers?: string | null
  themeChoice?: string | null
}) {
  const segments = segmentChatParts(parts)

  return (
    <div className="flex flex-col gap-2">
      {segments.map((segment) => {
        if (segment.type === 'tools') {
          const askUserParts = segment.parts.filter(
            ({ part }) => part.type === 'tool-call' && part.toolName === 'ask_user',
          )
          const themeParts = segment.parts.filter(
            ({ part }) => part.type === 'tool-call' && part.toolName === 'propose_themes',
          )
          const otherParts = segment.parts.filter(
            ({ part }) =>
              !isInteractiveToolPart(part, 'ask_user') &&
              !isInteractiveToolPart(part, 'propose_themes'),
          )
          const callCount = otherParts.filter(({ part }) => part.type === 'tool-call').length

          return (
            <div className="flex flex-col gap-2" key={`tools-${segment.parts[0]?.index}`}>
              {askUserParts.map(({ index, part }) => {
                const parsed =
                  part.type === 'tool-call'
                    ? agentQuestionRequestSchema.safeParse(part.input)
                    : null
                if (!parsed?.success) {
                  return <ToolActivityLine key={`tool-${index}`} part={part} />
                }
                return (
                  <AskUserTranscript
                    answersContent={askUserAnswers}
                    key={`ask-user-${index}`}
                    request={parsed.data}
                  />
                )
              })}
              {themeParts.map(({ index, part }) => {
                const parsed =
                  part.type === 'tool-call'
                    ? themeProposalRequestSchema.safeParse(part.input)
                    : null
                if (!parsed?.success) {
                  return <ToolActivityLine key={`tool-${index}`} part={part} />
                }
                return (
                  <ThemeProposalTranscript
                    choiceContent={themeChoice}
                    key={`propose-themes-${index}`}
                    request={parsed.data}
                  />
                )
              })}
              {callCount > 0 ? (
                <details className="text-xs">
                  <summary className="cursor-pointer select-none font-medium text-muted-foreground">
                    {callCount === 1 ? '1 tool call' : `${callCount} tool calls`}
                  </summary>
                  <div className="mt-1 flex flex-col gap-1 pl-4">
                    {otherParts.map(({ index, part }) => (
                      <ToolActivityLine key={`tool-${index}`} part={part} />
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          )
        }

        const { part, index } = segment
        if (part.type === 'text') {
          return <MessageResponse key={`text-${index}`}>{part.content}</MessageResponse>
        }

        if (part.type === 'thinking') {
          return (
            <details className="text-xs" key={`thinking-${index}`}>
              <summary className="cursor-pointer select-none font-medium text-muted-foreground">
                {formatThinkingSummaryLabel(part.durationMs, live)}
              </summary>
              <div className="mt-1 whitespace-pre-wrap pl-4 text-muted-foreground/80">
                {part.content}
              </div>
            </details>
          )
        }

        return null
      })}
    </div>
  )
}

export type ChatPanelProps = {
  messages: ChatMessage[]
  input: string
  isGenerating: boolean
  generationStatus: GenerationJobStatus | null
  activeSteps: AgentStep[]
  /** Job id for the in-flight or just-finished generation; used to bridge live → final UI. */
  activeJobId?: string | null
  failedJobId: string | null
  error: string
  showGenerationErrorAlert?: boolean
  attachmentError: string
  models: AvailableModel[]
  selectedModel: string
  reasoningEffort?: ReasoningEffort
  isLoadingModels: boolean
  modelsError: string
  modelWarnings: string[]
  canGenerate: boolean
  /** Context chips (selected element / attached slides) in the composer attachment row. */
  contextSlot?: ReactNode
  onInputChange: (value: string) => void
  onModelSelect: (modelId: string, reasoningEffort?: ReasoningEffort) => void
  onPromptSubmit: (message: PromptInputMessage) => void
  onQuestionSubmit?: (content: string) => void
  onAttachmentError: (message: string) => void
  onCancelGeneration: () => void | Promise<void>
  onRetryGeneration: () => void | Promise<void>
  reducedMotion?: boolean
  resolvedAppearance?: ResolvedAppearance
  getMessageDeliveryStatus?: (messageId: string) => MessageDeliveryStatus | undefined
  getReasoningEffort?: (modelId: string) => ReasoningEffort | undefined
  onRetryPersist?: (messageId: string) => void | Promise<void | boolean>
}

export function ChatPanel({
  messages,
  input,
  isGenerating,
  activeSteps,
  activeJobId = null,
  failedJobId,
  error,
  showGenerationErrorAlert = true,
  attachmentError,
  models,
  selectedModel,
  reasoningEffort,
  isLoadingModels,
  modelsError,
  modelWarnings,
  canGenerate,
  contextSlot,
  onInputChange,
  onModelSelect,
  onPromptSubmit,
  onQuestionSubmit,
  onAttachmentError,
  onCancelGeneration,
  onRetryGeneration,
  reducedMotion = false,
  resolvedAppearance = 'dark',
  getMessageDeliveryStatus,
  getReasoningEffort,
  onRetryPersist,
  generationStatus,
}: ChatPanelProps) {
  const selectedModelInfo = models.find((model) => model.id === selectedModel)
  const supportsAttachments = selectedModelInfo?.supportsAttachments ?? false
  const [dismissedAlertKeys, setDismissedAlertKeys] = useState<Set<string>>(() => new Set())
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const modelWarningsKey = modelWarnings.join('\n')
  const finalizedLiveMessage =
    activeJobId != null && messages.some((message) => message.id === activeJobId)
  const showLiveAssistant =
    !finalizedLiveMessage &&
    (isGenerating ||
      (generationStatus === 'succeeded' && activeSteps.length > 0 && activeJobId != null))

  const isAlertDismissed = (alertId: ChatAlertId, content: string) =>
    dismissedAlertKeys.has(alertDismissKey(alertId, content))

  const dismissAlert = (alertId: ChatAlertId, content: string) => {
    setDismissedAlertKeys((current) => new Set(current).add(alertDismissKey(alertId, content)))
  }

  const handleRetryGeneration = () => {
    dismissAlert('generation', error)
    void onRetryGeneration()
  }

  const showGenerationError =
    showGenerationErrorAlert && Boolean(error) && !isAlertDismissed('generation', error)
  const showAttachmentError =
    Boolean(attachmentError) && !isAlertDismissed('attachment', attachmentError)
  const showModelsError = Boolean(modelsError) && !isAlertDismissed('models', modelsError)
  const showModelWarnings =
    modelWarnings.length > 0 && !isAlertDismissed('model-warnings', modelWarningsKey)
  const hasFloatingAlerts =
    showGenerationError || showAttachmentError || showModelsError || showModelWarnings
  const pendingAgentQuestions = onQuestionSubmit ? findPendingAgentQuestions(messages) : null
  const pendingThemeProposal = onQuestionSubmit ? findPendingThemeProposal(messages) : null
  const activeQuestions = pendingAgentQuestions
  const activeThemes = pendingThemeProposal
  const interactionActive = Boolean(activeQuestions || activeThemes)
  const isSubmitDisabled = isGenerating || !canGenerate || interactionActive

  return (
    <Card className="flex h-full min-h-0 gap-0 rounded-none border-0 bg-[var(--ark-panel)] py-0 shadow-none ring-0 [--card-spacing:0]">
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <Conversation>
          <ConversationContent className="gap-5 px-5 py-6">
            {messages.length === 0 && !interactionActive ? (
              <div className="flex min-h-full flex-col items-center justify-center gap-5 px-4 text-center">
                <ConversationEmptyState
                  description="Start with an audience, raw notes, or one clear outcome."
                  icon={<SparklesIcon className="size-8" />}
                  title="Direct the next cut"
                />
                <div className="flex max-w-sm flex-col gap-2">
                  {[
                    'Turn my notes into a concise narrative',
                    'Build a six-slide pitch for this idea',
                    'Give this deck a sharper visual hierarchy',
                  ].map((prompt) => (
                    <Button
                      className="h-auto justify-start whitespace-normal text-left"
                      key={prompt}
                      onClick={() => onInputChange(prompt)}
                      size="sm"
                      variant="outline"
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            ) : messages.length > 0 ? (
              messages.map((message, index) => {
                // Answers stay in history for the model, but render under the matching tool call.
                if (isAskUserAnswerMessage(messages, index)) return null
                if (isThemeChoiceMessage(messages, index)) return null

                const askUserAnswers =
                  message.role === 'assistant'
                    ? (findAskUserAnswerAfter(messages, index)?.content ?? null)
                    : null
                const themeChoice =
                  message.role === 'assistant'
                    ? (findThemeChoiceAfter(messages, index)?.content ?? null)
                    : null

                return (
                  <Message from={message.role} key={message.id}>
                    <MessageContent>
                      {message.parts?.length ? (
                        <ChatMessageParts
                          askUserAnswers={askUserAnswers}
                          parts={message.parts}
                          themeChoice={themeChoice}
                        />
                      ) : (
                        <MessageResponse>{message.content}</MessageResponse>
                      )}
                      {message.attachments?.length ? (
                        <ChatMessageAttachments attachments={message.attachments} />
                      ) : null}
                      {message.role === 'user' && message.context ? (
                        <ContextChipList
                          className="mt-2"
                          label="Attached context"
                          {...contextToChipProps(message.context)}
                        />
                      ) : null}
                      <ChatMessageDeliveryStatus
                        onRetry={
                          onRetryPersist
                            ? () => {
                                void onRetryPersist(message.id)
                              }
                            : undefined
                        }
                        status={getMessageDeliveryStatus?.(message.id)}
                      />
                    </MessageContent>
                  </Message>
                )
              })
            ) : null}
            {showLiveAssistant ? (
              <Message from="assistant">
                <MessageContent>
                  <div className="flex flex-col gap-2">
                    <span className="sr-only">Working…</span>
                    {activeSteps.length > 0 ? (
                      <ChatMessageParts live parts={agentStepsToChatParts(activeSteps)} />
                    ) : null}
                  </div>
                </MessageContent>
              </Message>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="relative shrink-0 bg-[var(--ark-paper)] p-4" data-slot="agent-composer">
          {isGenerating ? (
            <div className="mb-2 flex min-h-5 items-center px-1">
              <AgentPresence
                activeSteps={activeSteps}
                generationStatus={generationStatus}
                reducedMotion={reducedMotion}
                resolvedAppearance={resolvedAppearance}
              />
            </div>
          ) : null}
          {activeQuestions && onQuestionSubmit ? (
            <AgentQuestions
              disabled={isGenerating || !canGenerate}
              onSubmit={(answers) =>
                onQuestionSubmit(formatAgentQuestionAnswers(activeQuestions, answers))
              }
              request={activeQuestions}
              submitLabel="Send answers"
            />
          ) : null}
          {activeThemes && onQuestionSubmit ? (
            <ThemePicker
              disabled={isGenerating || !canGenerate}
              onSubmit={(themeId) => onQuestionSubmit(formatThemeChoice(activeThemes, themeId))}
              request={activeThemes}
              submitLabel="Use this theme"
            />
          ) : null}

          {hasFloatingAlerts ? (
            <div className="absolute inset-x-4 bottom-full z-10 mb-2 flex flex-col gap-2">
              {showGenerationError ? (
                <ChatFloatingAlert
                  onClose={() => dismissAlert('generation', error)}
                  title="Generation failed"
                  variant="destructive"
                >
                  <div className="flex flex-col gap-2">
                    <span>{error}</span>
                    {failedJobId ? (
                      <div>
                        <PromptInputButton
                          aria-label="Retry generation"
                          onClick={handleRetryGeneration}
                          tooltip="Retry generation"
                        >
                          <RefreshCwIcon className="size-4" />
                          Retry
                        </PromptInputButton>
                      </div>
                    ) : null}
                  </div>
                </ChatFloatingAlert>
              ) : null}

              {showAttachmentError ? (
                <ChatFloatingAlert
                  onClose={() => dismissAlert('attachment', attachmentError)}
                  title="Attachment error"
                  variant="destructive"
                >
                  {attachmentError}
                </ChatFloatingAlert>
              ) : null}

              {showModelsError ? (
                <ChatFloatingAlert
                  onClose={() => dismissAlert('models', modelsError)}
                  title="Could not load models"
                  variant="destructive"
                >
                  {modelsError}
                </ChatFloatingAlert>
              ) : null}

              {showModelWarnings ? (
                <ChatFloatingAlert
                  onClose={() => dismissAlert('model-warnings', modelWarningsKey)}
                  title="Model catalog notice"
                >
                  <ul className="flex list-disc flex-col gap-1 pl-4">
                    {modelWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </ChatFloatingAlert>
              ) : null}
            </div>
          ) : null}

          <ActiveComposer
            active={isGenerating || interactionActive}
            reducedMotion={reducedMotion}
            resolvedAppearance={resolvedAppearance}
          >
            <PromptInput
              accept="image/*,text/*,application/pdf"
              className="border-[var(--ark-line)] bg-[var(--ark-paper)] shadow-none"
              maxFileSize={MAX_CHAT_ATTACHMENT_BYTES}
              multiple
              onError={(error) => onAttachmentError(formatAttachmentError(error))}
              onSubmit={onPromptSubmit}
            >
              <PromptInputAttachmentsDisplay>{contextSlot}</PromptInputAttachmentsDisplay>
              <PromptInputBody>
                <PromptInputTextarea
                  className="min-h-24 resize-none bg-transparent"
                  disabled={isGenerating || interactionActive}
                  onChange={(event) => onInputChange(event.currentTarget.value)}
                  placeholder={
                    activeThemes
                      ? 'Pick a theme above to continue…'
                      : activeQuestions
                        ? 'Answer the questions above to continue…'
                        : 'Describe the deck you want, or ask for an edit…'
                  }
                  value={input}
                />
              </PromptInputBody>
              <PromptInputFooter className="min-w-0 gap-2">
                <PromptInputTools className="min-w-0 flex-1 gap-2 overflow-hidden">
                  <PromptInputActionMenu onOpenChange={setAttachMenuOpen} open={attachMenuOpen}>
                    <PromptInputActionMenuTrigger
                      aria-label="Add attachments"
                      className={cn(morphMenuTriggerClassName, 'shrink-0')}
                      disabled={!supportsAttachments || isGenerating || interactionActive}
                    />
                    {supportsAttachments ? (
                      <MorphMenuContent className="w-48">
                        <div className="ark-scrollbar-none ark-morph-reveal min-h-0 flex-1 overflow-y-auto p-1">
                          <PromptInputActionAddAttachments />
                          <PromptInputActionAddScreenshot />
                        </div>
                        <MorphMenuFooter
                          className="px-2"
                          label="Collapse attachments menu"
                          onCollapse={() => setAttachMenuOpen(false)}
                        >
                          <PlusIcon aria-hidden className="size-4 shrink-0" />
                        </MorphMenuFooter>
                      </MorphMenuContent>
                    ) : null}
                  </PromptInputActionMenu>
                  <ModelSelector
                    canGenerate={canGenerate}
                    className="min-w-0"
                    disabled={isGenerating}
                    isLoading={isLoadingModels}
                    models={models}
                    getReasoningEffort={getReasoningEffort}
                    onSelect={onModelSelect}
                    reasoningEffort={reasoningEffort}
                    value={selectedModel}
                  />
                </PromptInputTools>
                <ChatPromptInputSubmit
                  input={input}
                  isGenerating={isGenerating}
                  isInputDisabled={isSubmitDisabled}
                  onCancelGeneration={onCancelGeneration}
                />
              </PromptInputFooter>
            </PromptInput>
          </ActiveComposer>
        </div>
      </CardContent>
    </Card>
  )
}
