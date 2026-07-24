import {
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
  useState,
} from 'react'
import type { BorderBeamProps } from 'border-beam'
import { AlertCircleIcon, Loader2Icon, RefreshCwIcon, SparklesIcon, XIcon } from 'lucide-react'

import { AgentPresence } from '@/components/AgentPresence'
import {
  Attachment,
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
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
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
import {
  agentStepsToChatParts,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENT_BYTES,
} from '@ark/deck-core/chat.ts'
import type { GenerationJobStatus } from '@ark/deck-core/generation-job.ts'
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
  if (!active || reducedMotion) {
    return (
      <div className={cn(active && 'rounded-lg ring-1 ring-[var(--ark-focus)]')}>{children}</div>
    )
  }

  return (
    <Suspense
      fallback={<div className="rounded-lg ring-1 ring-[var(--ark-focus)]">{children}</div>}
    >
      <BorderBeam
        colorVariant="mono"
        duration={3.1}
        size="line"
        staticColors
        strength={0.7}
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
    case 'max_files':
      return `You can attach up to ${MAX_CHAT_ATTACHMENTS} files.`
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
        </Attachment>
      ))}
    </Attachments>
  )
}

function PromptInputAttachmentsDisplay() {
  const attachments = usePromptInputAttachments()

  if (attachments.files.length === 0) {
    return null
  }

  return (
    <Attachments variant="inline">
      {attachments.files.map((attachment) => (
        <Attachment
          data={attachment}
          key={attachment.id}
          onRemove={() => attachments.remove(attachment.id)}
        >
          <AttachmentPreview />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  )
}

function ChatPromptInputSubmit({
  input,
  isInputDisabled,
  isGenerating,
  selectedAssetIds,
}: {
  input: string
  isInputDisabled: boolean
  isGenerating: boolean
  selectedAssetIds: string[]
}) {
  const attachments = usePromptInputAttachments()
  const canSubmit = Boolean(
    input.trim() || attachments.files.length > 0 || selectedAssetIds.length > 0,
  )

  return (
    <PromptInputSubmit
      disabled={!canSubmit || isInputDisabled}
      status={isGenerating ? 'submitted' : 'ready'}
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

    const callCount = run.filter(({ part: toolPart }) => toolPart.type === 'tool-call').length
    if (callCount > 1) {
      segments.push({ type: 'tools', parts: run })
    } else {
      segments.push(
        ...run.map(({ index: partIndex, part: toolPart }) => ({
          type: 'part' as const,
          index: partIndex,
          part: toolPart,
        })),
      )
    }
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

function ChatMessageParts({
  parts,
  thinkingDefaultOpen = false,
}: {
  parts: ChatMessagePart[]
  thinkingDefaultOpen?: boolean
}) {
  const segments = segmentChatParts(parts)

  return (
    <div className="flex flex-col gap-2">
      {segments.map((segment) => {
        if (segment.type === 'tools') {
          const callCount = segment.parts.filter(({ part }) => part.type === 'tool-call').length
          return (
            <details className="text-xs" key={`tools-${segment.parts[0]?.index}`}>
              <summary className="cursor-pointer select-none font-medium text-muted-foreground">
                {callCount} tool calls
              </summary>
              <div className="mt-1 flex flex-col gap-1 pl-4">
                {segment.parts.map(({ index, part }) => (
                  <ToolActivityLine key={`tool-${index}`} part={part} />
                ))}
              </div>
            </details>
          )
        }

        const { part, index } = segment
        if (part.type === 'text') {
          return <MessageResponse key={`text-${index}`}>{part.content}</MessageResponse>
        }

        if (part.type === 'thinking') {
          return (
            <details
              className="text-xs"
              key={`thinking-${index}`}
              open={thinkingDefaultOpen || undefined}
            >
              <summary className="cursor-pointer select-none font-medium text-muted-foreground">
                Thinking
              </summary>
              <div className="mt-1 whitespace-pre-wrap pl-4 text-muted-foreground/80">
                {part.content}
              </div>
            </details>
          )
        }

        return <ToolActivityLine key={`tool-${index}`} part={part} />
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
  selectedAssetIds?: string[]
  assetsSlot?: ReactNode
  onInputChange: (value: string) => void
  onModelSelect: (modelId: string, reasoningEffort?: ReasoningEffort) => void
  onPromptSubmit: (message: PromptInputMessage) => void
  onAttachmentError: (message: string) => void
  onCancelGeneration: () => void | Promise<void>
  onRetryGeneration: () => void | Promise<void>
  reducedMotion?: boolean
  resolvedAppearance?: ResolvedAppearance
  getMessageDeliveryStatus?: (messageId: string) => MessageDeliveryStatus | undefined
  onRetryPersist?: (messageId: string) => void | Promise<void | boolean>
}

export function ChatPanel({
  messages,
  input,
  isGenerating,
  activeSteps,
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
  selectedAssetIds = [],
  assetsSlot,
  onInputChange,
  onModelSelect,
  onPromptSubmit,
  onAttachmentError,
  onCancelGeneration,
  onRetryGeneration,
  reducedMotion = false,
  resolvedAppearance = 'dark',
  getMessageDeliveryStatus,
  onRetryPersist,
  generationStatus,
}: ChatPanelProps) {
  const isSubmitDisabled = isGenerating || !canGenerate
  const selectedModelInfo = models.find((model) => model.id === selectedModel)
  const supportsAttachments = selectedModelInfo?.supportsAttachments !== false
  const [dismissedAlertKeys, setDismissedAlertKeys] = useState<Set<string>>(() => new Set())
  const modelWarningsKey = modelWarnings.join('\n')

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

  return (
    <Card className="flex h-full min-h-0 gap-0 rounded-none border-0 bg-[var(--ark-panel)] py-0 shadow-none ring-0 [--card-spacing:0]">
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <Conversation>
          <ConversationContent className="gap-5 px-5 py-6">
            {messages.length === 0 ? (
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
            ) : (
              messages.map((message) => (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    {message.parts?.length ? (
                      <ChatMessageParts parts={message.parts} />
                    ) : (
                      <MessageResponse>{message.content}</MessageResponse>
                    )}
                    {message.attachments?.length ? (
                      <ChatMessageAttachments attachments={message.attachments} />
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
              ))
            )}
            {isGenerating ? (
              <Message from="assistant">
                <MessageContent>
                  <div className="flex flex-col gap-2">
                    <span className="sr-only">Working…</span>
                    {activeSteps.length > 0 ? (
                      <ChatMessageParts
                        parts={agentStepsToChatParts(activeSteps)}
                        thinkingDefaultOpen
                      />
                    ) : null}
                  </div>
                </MessageContent>
              </Message>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div
          className="relative shrink-0 border-t border-[var(--ark-line)] bg-[var(--ark-paper)] p-4"
          data-slot="agent-composer"
        >
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
          {assetsSlot}

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
            active={isGenerating}
            reducedMotion={reducedMotion}
            resolvedAppearance={resolvedAppearance}
          >
            <PromptInput
              accept="image/*,text/*,application/pdf"
              className="border-[var(--ark-line)] bg-[var(--ark-paper)] shadow-none"
              maxFileSize={MAX_CHAT_ATTACHMENT_BYTES}
              maxFiles={MAX_CHAT_ATTACHMENTS}
              multiple
              onError={(error) => onAttachmentError(formatAttachmentError(error))}
              onSubmit={onPromptSubmit}
            >
              <PromptInputHeader>
                <PromptInputAttachmentsDisplay />
              </PromptInputHeader>
              <PromptInputBody>
                <PromptInputTextarea
                  className="min-h-24 resize-none bg-transparent"
                  disabled={isGenerating}
                  onChange={(event) => onInputChange(event.currentTarget.value)}
                  placeholder="Describe the deck you want, or ask for an edit…"
                  value={input}
                />
              </PromptInputBody>
              <PromptInputFooter className="gap-2">
                <PromptInputTools className="gap-1.5">
                  <PromptInputActionMenu>
                    <PromptInputActionMenuTrigger
                      aria-label="Add attachments"
                      disabled={!supportsAttachments || isGenerating}
                      tooltip={
                        supportsAttachments
                          ? 'Add attachments'
                          : 'This model is text-only and does not support attachments'
                      }
                    />
                    {supportsAttachments ? (
                      <PromptInputActionMenuContent>
                        <PromptInputActionAddAttachments />
                        <PromptInputActionAddScreenshot />
                      </PromptInputActionMenuContent>
                    ) : null}
                  </PromptInputActionMenu>
                  <ModelSelector
                    canGenerate={canGenerate}
                    disabled={isGenerating}
                    isLoading={isLoadingModels}
                    models={models}
                    onSelect={onModelSelect}
                    reasoningEffort={reasoningEffort}
                    value={selectedModel}
                  />
                  {isGenerating ? (
                    <PromptInputButton
                      aria-label="Cancel generation"
                      onClick={() => {
                        void onCancelGeneration()
                      }}
                      tooltip="Cancel generation"
                    >
                      <XIcon className="size-4" />
                      Cancel
                    </PromptInputButton>
                  ) : null}
                </PromptInputTools>
                <ChatPromptInputSubmit
                  input={input}
                  isGenerating={isGenerating}
                  isInputDisabled={isSubmitDisabled}
                  selectedAssetIds={selectedAssetIds}
                />
              </PromptInputFooter>
            </PromptInput>
          </ActiveComposer>
        </div>
      </CardContent>
    </Card>
  )
}
