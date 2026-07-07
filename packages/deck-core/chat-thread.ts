import type { ChatAttachment, ChatMessagePart } from './chat.ts'

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
}) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    ...(message.parts?.length ? { parts: message.parts } : {}),
  }
}
