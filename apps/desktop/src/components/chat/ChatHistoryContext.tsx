import { ContextChipList } from '@/components/ChatContextChips'
import { contextToChipProps } from '@/lib/chat/chat-context-chips'
import type { ChatMessage } from '@ark/chat/messages.ts'

export function ChatHistoryContext({ context }: { context: NonNullable<ChatMessage['context']> }) {
  return (
    <ContextChipList className="mt-2" label="Attached context" {...contextToChipProps(context)} />
  )
}
