import { isInteractiveToolPart, segmentChatParts } from '@/lib/chat/chat-message-parts'
import { agentQuestionRequestSchema } from '@ark/chat/agent-questions.ts'
import { parseStoredThemeProposalRequest } from '@ark/chat/agent-themes.ts'

import { AskUserTranscript } from './AskUserTranscript.tsx'
import { ThemeProposalTranscript } from './ThemeProposalTranscript.tsx'
import { ToolActivityLine } from './ToolActivityLine.tsx'

export function ChatToolSegment({
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
