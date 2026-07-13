import type { ReactNode } from 'react'
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
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { formatModelLabel, type AvailableModel } from '@/hooks/useAvailableModels'
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
  canGenerate: boolean
  selectedAssetIds?: string[]
  assetsSlot?: ReactNode
  onInputChange: (value: string) => void
  onModelChange: (modelId: string) => void
  onRefreshModels: () => Promise<void>
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
  canGenerate,
  selectedAssetIds = [],
  assetsSlot,
  onInputChange,
  onModelChange,
  onRefreshModels,
  onPromptSubmit,
  onAttachmentError,
  onCancelGeneration,
  onRetryGeneration,
  getMessageDeliveryStatus,
  onRetryPersist,
}: ChatPanelProps) {
  const isSubmitDisabled = isGenerating || !canGenerate
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

        <div className="shrink-0 border-t bg-white p-4">
          {assetsSlot}
          {error ? (
            <Alert className="mb-3" variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Generation failed</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <span>{error}</span>
                {failedJobId ? (
                  <div>
                    <PromptInputButton
                      aria-label="Retry generation"
                      onClick={() => {
                        void onRetryGeneration()
                      }}
                      tooltip="Retry generation"
                    >
                      <RefreshCwIcon className="size-4" />
                      Retry
                    </PromptInputButton>
                  </div>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {attachmentError ? (
            <Alert className="mb-3" variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Attachment error</AlertTitle>
              <AlertDescription>{attachmentError}</AlertDescription>
            </Alert>
          ) : null}

          {modelsError ? (
            <Alert className="mb-3" variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Could not load models</AlertTitle>
              <AlertDescription>{modelsError}</AlertDescription>
            </Alert>
          ) : null}

          <PromptInput
            accept="image/*,text/*,application/pdf"
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
                className="min-h-24 resize-none"
                disabled={isGenerating}
                onChange={(event) => onInputChange(event.currentTarget.value)}
                placeholder="Describe the deck you want, or ask for an edit…"
                value={input}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
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
                <PromptInputSelect
                  disabled={isGenerating}
                  onValueChange={onModelChange}
                  value={selectedModel}
                >
                  <PromptInputSelectTrigger
                    className={cn('max-w-[300px]', !canGenerate && 'text-muted-foreground')}
                  >
                    <PromptInputSelectValue
                      placeholder={isLoadingModels ? 'Loading models…' : 'Select model'}
                    />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    {models.map((model) => (
                      <PromptInputSelectItem
                        className={cn(!model.available && 'text-muted-foreground opacity-60')}
                        disabled={!model.available}
                        key={model.id}
                        value={model.id}
                      >
                        {formatModelLabel(model)}
                      </PromptInputSelectItem>
                    ))}
                  </PromptInputSelectContent>
                </PromptInputSelect>
                <PromptInputButton
                  aria-label="Refresh available models"
                  disabled={isGenerating || isLoadingModels}
                  onClick={() => {
                    void onRefreshModels()
                  }}
                  tooltip="Refresh models"
                >
                  <RefreshCwIcon className={cn('size-4', isLoadingModels && 'animate-spin')} />
                </PromptInputButton>
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
