import type { ChatAttachment, ChatMessage } from '../../shared/chat.ts'

const CHAT_SESSION_STORAGE_KEY = 'ark:chat-session'
const LEGACY_DECK_SESSION_STORAGE_KEY = 'ark:deck-session'

export type ChatSession = {
  messages: ChatMessage[]
  updatedAt: string
}

const isChatAttachment = (value: unknown): value is ChatAttachment =>
  typeof value === 'object' &&
  value !== null &&
  (value as ChatAttachment).type === 'file' &&
  typeof (value as ChatAttachment).mediaType === 'string' &&
  typeof (value as ChatAttachment).url === 'string'

const isChatMessage = (value: unknown): value is ChatMessage =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ChatMessage).id === 'string' &&
  ((value as ChatMessage).role === 'user' || (value as ChatMessage).role === 'assistant') &&
  typeof (value as ChatMessage).content === 'string' &&
  ((value as ChatMessage).attachments === undefined ||
    (Array.isArray((value as ChatMessage).attachments) &&
      (value as ChatMessage).attachments!.every(isChatAttachment)))

const isChatSession = (value: unknown): value is ChatSession =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as ChatSession).messages) &&
  (value as ChatSession).messages.every(isChatMessage) &&
  typeof (value as ChatSession).updatedAt === 'string'

const parseStoredSession = (raw: string | null): ChatSession | null => {
  if (!raw) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)

    if (isChatSession(parsed)) {
      return parsed
    }

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as { messages?: unknown }).messages) &&
      (parsed as { messages: unknown[] }).messages.every(isChatMessage)
    ) {
      return {
        messages: (parsed as { messages: ChatMessage[] }).messages,
        updatedAt:
          typeof (parsed as { updatedAt?: unknown }).updatedAt === 'string'
            ? (parsed as { updatedAt: string }).updatedAt
            : new Date().toISOString(),
      }
    }
  } catch {
    return null
  }

  return null
}

export const createChatSession = (): ChatSession => ({
  messages: [],
  updatedAt: new Date().toISOString(),
})

export const readChatSession = (): ChatSession | null => {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }

    const current = parseStoredSession(localStorage.getItem(CHAT_SESSION_STORAGE_KEY))
    if (current) {
      return current
    }

    return parseStoredSession(localStorage.getItem(LEGACY_DECK_SESSION_STORAGE_KEY))
  } catch {
    return null
  }
}

export const writeChatSession = (session: ChatSession) => {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }

    localStorage.setItem(
      CHAT_SESSION_STORAGE_KEY,
      JSON.stringify({
        ...session,
        updatedAt: new Date().toISOString(),
      }),
    )
    localStorage.removeItem(LEGACY_DECK_SESSION_STORAGE_KEY)
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}

export const clearChatSession = () => {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }

    localStorage.removeItem(CHAT_SESSION_STORAGE_KEY)
    localStorage.removeItem(LEGACY_DECK_SESSION_STORAGE_KEY)
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}
