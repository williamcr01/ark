import { type ReactNode, useState } from 'react'
import { AlertCircleIcon, Loader2Icon, RefreshCwIcon, SparklesIcon, XIcon } from 'lucide-react'

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
import { Card, CardContent } from '@/components/ui/card'
import { type AvailableModel } from '@/hooks/useAvailableModels'
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
    <div
      className={cn(
        'relative rounded-lg border px-3 py-2.5 pr-9 text-sm shadow-md backdrop-blur-sm',
        variant === 'destructive'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-amber-500/30 bg-amber-50/95 text-amber-950 dark:bg-amber-950/90 dark:text-amber-100',
      )}
      role="alert"
    >
      <button
        aria-label={`Dismiss ${title}`}
        className={cn(
          'absolute top-2 right-2 rounded-sm p-0.5 transition-colors',
          variant === 'destructive'
            ? 'text-destructive/70 hover:text-destructive'
            : 'text-amber-700/70 hover:text-amber-950 dark:text-amber-200/70 dark:hover:text-amber-50',
        )}
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-3.5" />
      </button>
      <div className="flex items-start gap-2">
        <AlertCircleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{title}</p>
          <div
            className={cn(
              'text-xs leading-relaxed',
              variant === 'destructive'
                ? 'text-destructive/90'
                : 'text-amber-900 dark:text-amber-100/90',
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
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

function ChatMessageParts({ parts }: { parts: ChatMessagePart[] }) {
  return (
    <div className="flex flex-col gap-2">
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return <MessageResponse key={`text-${index}`}>{part.content}</MessageResponse>
        }

        if (part.type === 'tool-call') {
          return (
            <div
              className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
              key={`tool-call-${index}`}
            >
              <span className="font-medium text-foreground">{formatToolLabel(part.toolName)}</span>
              {part.summary ? (
                <span className="text-muted-foreground"> — {part.summary}</span>
              ) : null}
            </div>
          )
        }

        return (
          <div
            className={cn(
              'rounded-md border px-3 py-2 text-xs',
              part.error
                ? 'border-destructive/30 bg-destructive/5 text-destructive'
                : 'border-emerald-500/20 bg-emerald-500/5 text-muted-foreground',
            )}
            key={`tool-result-${index}`}
          >
            <span
              className={cn('font-medium', part.error ? 'text-destructive' : 'text-foreground')}
            >
              {formatToolLabel(part.toolName)}
            </span>
            {part.summary ? (
              <span className={part.error ? 'text-destructive/90' : 'text-muted-foreground'}>
                {' '}
                — {part.summary}
              </span>
            ) : null}
          </div>
        )
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
  attachmentError: string
  models: AvailableModel[]
  selectedModel: string
  isLoadingModels: boolean
  modelsError: string
  modelWarnings: string[]
  canGenerate: boolean
  selectedAssetIds?: string[]
  assetsSlot?: ReactNode
  onInputChange: (value: string) => void
  onModelChange: (modelId: string) => void
  onPromptSubmit: (message: PromptInputMessage) => void
  onAttachmentError: (message: string) => void
  onCancelGeneration: () => void | Promise<void>
  onRetryGeneration: () => void | Promise<void>
  getMessageDeliveryStatus?: (messageId: string) => MessageDeliveryStatus | undefined
  onRetryPersist?: (messageId: string) => void | Promise<void | boolean>
}

export function ChatPanel({
  messages,
  input,
  isGenerating,
  generationStatus,
  activeSteps,
  failedJobId,
  error,
  attachmentError,
  models,
  selectedModel,
  isLoadingModels,
  modelsError,
  modelWarnings,
  canGenerate,
  selectedAssetIds = [],
  assetsSlot,
  onInputChange,
  onModelChange,
  onPromptSubmit,
  onAttachmentError,
  onCancelGeneration,
  onRetryGeneration,
  getMessageDeliveryStatus,
  onRetryPersist,
}: ChatPanelProps) {
  const isSubmitDisabled = isGenerating || !canGenerate
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

  const showGenerationError = Boolean(error) && !isAlertDismissed('generation', error)
  const showAttachmentError =
    Boolean(attachmentError) && !isAlertDismissed('attachment', attachmentError)
  const showModelsError = Boolean(modelsError) && !isAlertDismissed('models', modelsError)
  const showModelWarnings =
    modelWarnings.length > 0 && !isAlertDismissed('model-warnings', modelWarningsKey)
  const hasFloatingAlerts =
    showGenerationError || showAttachmentError || showModelsError || showModelWarnings

  return (
    <Card className="flex h-full min-h-0 gap-0 rounded-none border-0 py-0 shadow-none ring-0 [--card-spacing:0]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--ark-titlebar-border)] bg-[var(--ark-titlebar)] px-3">
        <div className="flex min-w-0 items-center gap-2 text-[var(--ark-titlebar-fg)]">
          <SparklesIcon aria-hidden className="size-3.5 shrink-0 text-[var(--ark-accent)]" />
          <span className="truncate text-xs font-medium">Chat</span>
          <span aria-hidden className="text-[var(--ark-titlebar-muted)]">
            ›
          </span>
          <span className="truncate text-xs text-[var(--ark-titlebar-muted)]">AI agent</span>
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
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2Icon className="size-4 animate-spin" />
                      {generationStatus === 'queued'
                        ? 'Queued for generation…'
                        : generationStatus === 'canceling'
                          ? 'Canceling generation…'
                          : 'Designing the deck and running agent tools…'}
                    </div>
                    {activeSteps.length > 0 ? (
                      <ChatMessageParts parts={agentStepsToChatParts(activeSteps)} />
                    ) : null}
                  </div>
                </MessageContent>
              </Message>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="relative shrink-0 border-t border-[var(--ark-line)] bg-[var(--ark-paper)] p-4">
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
                    tooltip="Add attachments"
                  />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                    <PromptInputActionAddScreenshot />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <ModelSelector
                  canGenerate={canGenerate}
                  disabled={isGenerating}
                  isLoading={isLoadingModels}
                  models={models}
                  onValueChange={onModelChange}
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
        </div>
      </CardContent>
    </Card>
  )
}
