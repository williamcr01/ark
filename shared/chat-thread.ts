import type { ChatAttachment, ChatMessagePart } from './chat.ts'

export type ChatThreadStatus = 'active' | 'archived'

export type ChatThreadSummary = {
  id: string
  deckId: string
  activeDeckVersionId: string | null
  title: string
  status: ChatThreadStatus
  createdAt: string
  updatedAt: string
}

export type ChatMessageError = {
  message: string
  code?: string | null
}

/** API-facing chat message returned from the server. */
export type PersistedChatMessage = {
  id: string
  threadId: string
  deckId: string
  deckVersionId: string | null
  role: 'user' | 'assistant'
  content: string
  parts?: ChatMessagePart[]
  attachments?: ChatAttachment[]
  generationJobId?: string | null
  generationStatus?: string | null
  model?: string | null
  error?: ChatMessageError | null
  createdAt: string
}

export type AppendChatMessageRequest = {
  id?: string
  role: 'user' | 'assistant'
  content: string
  parts?: ChatMessagePart[]
  attachments?: ChatAttachment[]
  deckVersionId?: string | null
  generationJobId?: string | null
  generationStatus?: string | null
  model?: string | null
  error?: ChatMessageError | null
}

export type DeckChatResponse = {
  thread: ChatThreadSummary | null
  messages: PersistedChatMessage[]
  hasMore: boolean
}

export function persistedMessageToChatMessage(message: PersistedChatMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    ...(message.parts?.length ? { parts: message.parts } : {}),
  }
}
