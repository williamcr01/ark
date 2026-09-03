import { MessageResponse } from '@/components/ai-elements/message'
import { formatThinkingSummaryLabel, segmentChatParts } from '@/lib/chat/chat-message-parts'
import type { ChatMessagePart } from '@ark/chat/messages.ts'

import { ChatToolSegment } from './ChatToolTranscript.tsx'

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
