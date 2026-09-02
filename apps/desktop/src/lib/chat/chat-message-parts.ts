import type { ChatMessage, ChatMessagePart } from '@ark/chat/messages.ts'
import type { GenerationJobStatus } from '@ark/chat/generation-job.ts'

export type IndexedToolPart = {
  index: number
  part: Extract<ChatMessagePart, { type: 'tool-call' | 'tool-result' }>
}

export type ChatPartSegment =
  | { type: 'part'; index: number; part: ChatMessagePart }
  | { type: 'tools'; parts: IndexedToolPart[] }

export function formatToolLabel(toolName: string) {
  return toolName.replace(/_/g, ' ')
}

export function segmentChatParts(parts: ChatMessagePart[]) {
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

export function formatThinkingSummaryLabel(durationMs: number | undefined, live: boolean) {
  if (durationMs === undefined) {
    return live ? 'Thinking' : 'Thought'
  }

  const seconds = Math.max(1, Math.round(durationMs / 1000))
  return seconds === 1 ? 'Thought for 1 second' : `Thought for ${seconds} seconds`
}

export function isInteractiveToolPart(part: ChatMessagePart, toolName: string) {
  return (part.type === 'tool-call' || part.type === 'tool-result') && part.toolName === toolName
}

export function shouldShowLiveAssistant(
  messages: ChatMessage[],
  isGenerating: boolean,
  activeJobId: string | null,
  generationStatus: GenerationJobStatus | null,
  activeStepsLength: number,
) {
  const finalizedLiveMessage =
    activeJobId != null && messages.some((message) => message.id === activeJobId)
  return (
    !finalizedLiveMessage &&
    (isGenerating ||
      (generationStatus === 'succeeded' && activeStepsLength > 0 && activeJobId != null))
  )
}
