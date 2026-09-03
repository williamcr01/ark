import type { ChatMessagePart } from '@ark/chat/messages.ts'
import type { ChatAttachment } from '@ark/chat/attachments.ts'
import type { ChatMessageContext } from '@ark/chat/context.ts'
import { isValidDeckId } from './deck-record.ts'

export type ChatThreadStatus = 'active' | 'archived'

export type ChatThread = {
  id: string
  deckId: string
  activeDocumentRevision: number | null
  title: string
  status: ChatThreadStatus
  visibility: 'private' | 'shared'
  createdAt: string
  updatedAt: string
}

export type StoredChatMessageError = { message: string; code?: string | null }

export type StoredChatMessage = {
  id: string
  threadId: string
  deckId: string
  documentRevision: number | null
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

export type AppendChatMessageInput = Omit<
  StoredChatMessage,
  'id' | 'threadId' | 'deckId' | 'documentRevision' | 'createdAt'
> & { id?: string }

export type ListChatMessagesOptions = { limit?: number; before?: string | null }
export type ListChatMessagesResult = {
  thread: ChatThread | null
  messages: StoredChatMessage[]
  hasMore: boolean
}

export const DEFAULT_CHAT_MESSAGE_LIMIT = 100
export const MAX_CHAT_MESSAGE_LIMIT = 500
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const isValidChatMessageId = (id: string) => UUID_PATTERN.test(id)
export const isValidChatThreadId = (id: string) => UUID_PATTERN.test(id)

export function normalizeChatMessageLimit(limit: unknown) {
  return typeof limit === 'number' && Number.isFinite(limit)
    ? Math.min(MAX_CHAT_MESSAGE_LIMIT, Math.max(1, Math.floor(limit)))
    : DEFAULT_CHAT_MESSAGE_LIMIT
}

export type ChatStore = {
  listThreads: (deckId: string) => Promise<ChatThread[]>
  createThread: (deckId: string, title?: string) => Promise<ChatThread>
  updateThread: (
    deckId: string,
    threadId: string,
    patch: { title?: string; archived?: boolean; visibility?: 'private' | 'shared' },
  ) => Promise<ChatThread | null>
  deleteThread: (deckId: string, threadId: string) => Promise<boolean>
  getOrCreateActiveThread: (deckId: string) => Promise<ChatThread>
  getActiveThread: (deckId: string) => Promise<ChatThread | null>
  listMessages: (
    deckId: string,
    options?: ListChatMessagesOptions,
  ) => Promise<ListChatMessagesResult>
  appendMessage: (deckId: string, input: AppendChatMessageInput) => Promise<StoredChatMessage>
  clearThread: (deckId: string) => Promise<boolean>
}

export function assertValidDeckIdForChat(deckId: string) {
  if (!isValidDeckId(deckId)) throw new Error('Invalid deck id.')
}
