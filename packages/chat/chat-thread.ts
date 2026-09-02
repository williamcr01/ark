import type { ChatAttachment } from './attachments.ts'
import type { ChatMessageContext } from './context.ts'
import type { ChatMessagePart } from './messages.ts'

export type ChatThreadStatus = 'active' | 'archived'

export type ChatMessageError = {
  message: string
  code?: string | null
}

export const CHAT_HISTORY_PAGE_SIZE = 500

export function persistedMessageToChatMessage(message: {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: ChatAttachment[]
  parts?: ChatMessagePart[]
  context?: ChatMessageContext
}) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    ...(message.parts?.length ? { parts: message.parts } : {}),
    ...(message.role === 'user' && message.context ? { context: message.context } : {}),
  }
}
