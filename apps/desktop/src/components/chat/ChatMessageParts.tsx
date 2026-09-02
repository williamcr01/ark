import { AlertCircleIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react'

import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from '@/components/ai-elements/attachments'
import { MessageResponse } from '@/components/ai-elements/message'
import { ContextChipList } from '@/components/ChatContextChips'
import { contextToChipProps } from '@/lib/chat/chat-context-chips'
import {
  formatThinkingSummaryLabel,
  formatToolLabel,
  isInteractiveToolPart,
  segmentChatParts,
  type IndexedToolPart,
} from '@/lib/chat/chat-message-parts'
import { formatThemeFontPairingLabel } from '@/lib/chat/theme-fonts'
import { cn } from '@/lib/ui/utils'
import type { MessageDeliveryStatus } from '@/state/chat-store.ts'
import type { ChatAttachment, ChatMessage, ChatMessagePart } from '@ark/chat/chat.ts'
import {
  agentQuestionRequestSchema,
  parseAgentQuestionAnswerLines,
  type AgentQuestionRequest,
} from '@ark/chat/agent-questions.ts'
import {
  parseStoredThemeProposalRequest,
  parseThemeChoiceFonts,
  parseThemeChoiceName,
  type StoredThemeProposalRequest,
} from '@ark/chat/agent-themes.ts'

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
  request: StoredThemeProposalRequest
  choiceContent?: string | null
}) {
  const chosenName = choiceContent ? parseThemeChoiceName(request, choiceContent) : null
  const chosenFonts = choiceContent ? parseThemeChoiceFonts(choiceContent) : null
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
          {chosenFonts ? (
            <p className="text-muted-foreground text-[11px]">
              {formatThemeFontPairingLabel(chosenFonts)}
            </p>
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

export function ChatMessageAttachments({ attachments }: { attachments: ChatAttachment[] }) {
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
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- append-only per-message attachment list: ChatAttachment has no stable id and attachments never reorder/filter after send (rule's documented suppression)
          key={`${attachment.filename ?? 'attachment'}-${index}`}
        >
          <AttachmentPreview />
          <AttachmentInfo />
        </Attachment>
      ))}
    </Attachments>
  )
}

export function ChatMessageDeliveryStatus({
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

export function ChatHistoryContext({ context }: { context: NonNullable<ChatMessage['context']> }) {
  return (
    <ContextChipList className="mt-2" label="Attached context" {...contextToChipProps(context)} />
  )
}

export function ChatMessageParts({
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
          return (
            <ChatToolSegment
              askUserAnswers={askUserAnswers}
              key={`tools-${segment.parts[0]?.index}`}
              segment={segment}
              themeChoice={themeChoice}
            />
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

function ChatToolSegment({
  segment,
  askUserAnswers,
  themeChoice,
}: {
  segment: Extract<ReturnType<typeof segmentChatParts>[number], { type: 'tools' }>
  askUserAnswers: string | null
  themeChoice: string | null
}) {
  const askUserParts = segment.parts.filter(
    ({ part }) => part.type === 'tool-call' && part.toolName === 'ask_user',
  )
  const themeParts = segment.parts.filter(
    ({ part }) => part.type === 'tool-call' && part.toolName === 'propose_themes',
  )
  const otherParts = segment.parts.filter(
    ({ part }) =>
      !isInteractiveToolPart(part, 'ask_user') && !isInteractiveToolPart(part, 'propose_themes'),
  )
  const callCount = otherParts.filter(({ part }) => part.type === 'tool-call').length

  return (
    <div className="flex flex-col gap-2">
      {askUserParts.map(({ index, part }) => {
        const parsed =
          part.type === 'tool-call' ? agentQuestionRequestSchema.safeParse(part.input) : null
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
          part.type === 'tool-call' ? parseStoredThemeProposalRequest(part.input) : null
        if (!parsed) {
          return <ToolActivityLine key={`tool-${index}`} part={part} />
        }
        return (
          <ThemeProposalTranscript
            choiceContent={themeChoice}
            key={`propose-themes-${index}`}
            request={parsed}
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
