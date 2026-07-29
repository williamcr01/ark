import type { ChatAttachment, ChatMessageContext, ChatMessagePart } from '@ark/deck-core/chat.ts'
import { isValidDeckId } from './deck-record.ts'

export type ChatThreadStatus = 'active' | 'archived'

export type ChatThread = {
  id: string
  deckId: string
  activeDeckVersionId: string | null
  title: string
  status: ChatThreadStatus
  createdAt: string
  updatedAt: string
}

export type StoredChatMessageError = {
  message: string
  code?: string | null
}

export type StoredChatMessage = {
  id: string
  threadId: string
  deckId: string
  deckVersionId: string | null
  role: 'user' | 'assistant'
  content: string
  parts?: ChatMessagePart[]
  attachments?: ChatAttachment[]
  context?: ChatMessageContext
  generationJobId?: string | null
  generationStatus?: string | null
  model?: string | null
  error?: StoredChatMessageError | null
  createdAt: string
}

export type AppendChatMessageInput = {
  id?: string
  role: 'user' | 'assistant'
  content: string
  parts?: ChatMessagePart[]
  attachments?: ChatAttachment[]
  context?: ChatMessageContext
  deckVersionId?: string | null
  generationJobId?: string | null
  generationStatus?: string | null
  model?: string | null
  error?: StoredChatMessageError | null
}

export type ListChatMessagesOptions = {
  limit?: number
  before?: string | null
}

export type ListChatMessagesResult = {
  thread: ChatThread | null
  messages: StoredChatMessage[]
  hasMore: boolean
}

export const DEFAULT_CHAT_MESSAGE_LIMIT = 100
export const MAX_CHAT_MESSAGE_LIMIT = 500

const CHAT_MESSAGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const CHAT_THREAD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidChatMessageId(id: string) {
  return CHAT_MESSAGE_ID_PATTERN.test(id)
}

export function isValidChatThreadId(id: string) {
  return CHAT_THREAD_ID_PATTERN.test(id)
}

export function normalizeChatMessageLimit(limit: unknown) {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_CHAT_MESSAGE_LIMIT
  }

  return Math.min(MAX_CHAT_MESSAGE_LIMIT, Math.max(1, Math.floor(limit)))
}

export type ChatStore = {
  getOrCreateActiveThread: (
    deckId: string,
    activeDeckVersionId?: string | null,
  ) => Promise<ChatThread>
  getActiveThread: (deckId: string) => Promise<ChatThread | null>
  listMessages: (
    deckId: string,
    options?: ListChatMessagesOptions,
  ) => Promise<ListChatMessagesResult>
  appendMessage: (deckId: string, input: AppendChatMessageInput) => Promise<StoredChatMessage>
  clearThread: (deckId: string) => Promise<boolean>
}

export function assertValidDeckIdForChat(deckId: string) {
  if (!isValidDeckId(deckId)) {
    throw Object.assign(new Error('Invalid deck id.'), {
      apiError: {
        code: 'provider_error',
        error: 'Invalid deck id.',
      },
    })
  }
}
