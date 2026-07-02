import type { ChatMessage } from '../../shared/chat.ts'

const CHAT_SESSION_STORAGE_PREFIX = 'ark:chat-session:'
const LEGACY_CHAT_SESSION_STORAGE_KEY = 'ark:chat-session'
const LEGACY_DECK_SESSION_STORAGE_KEY = 'ark:deck-session'

export type ChatSession = {
  messages: ChatMessage[]
  updatedAt: string
}

const isChatMessage = (value: unknown): value is ChatMessage =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ChatMessage).id === 'string' &&
  ((value as ChatMessage).role === 'user' || (value as ChatMessage).role === 'assistant') &&
  typeof (value as ChatMessage).content === 'string'

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

export function getChatSessionStorageKey(deckId: string | null) {
  return `${CHAT_SESSION_STORAGE_PREFIX}${deckId ?? 'new'}`
}

export const createChatSession = (): ChatSession => ({
  messages: [],
  updatedAt: new Date().toISOString(),
})

export const readChatSession = (deckId: string | null = null): ChatSession | null => {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }

    const current = parseStoredSession(localStorage.getItem(getChatSessionStorageKey(deckId)))

    if (current) {
      return current
    }

    if (deckId === null) {
      return (
        parseStoredSession(localStorage.getItem(LEGACY_CHAT_SESSION_STORAGE_KEY)) ??
        parseStoredSession(localStorage.getItem(LEGACY_DECK_SESSION_STORAGE_KEY))
      )
    }

    return null
  } catch {
    return null
  }
}

export const writeChatSession = (deckId: string | null, session: ChatSession) => {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }

    localStorage.setItem(
      getChatSessionStorageKey(deckId),
      JSON.stringify({
        ...session,
        updatedAt: new Date().toISOString(),
      }),
    )

    if (deckId === null) {
      localStorage.removeItem(LEGACY_CHAT_SESSION_STORAGE_KEY)
      localStorage.removeItem(LEGACY_DECK_SESSION_STORAGE_KEY)
    }
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}

export const clearChatSession = (deckId: string | null = null) => {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }

    localStorage.removeItem(getChatSessionStorageKey(deckId))

    if (deckId === null) {
      localStorage.removeItem(LEGACY_CHAT_SESSION_STORAGE_KEY)
      localStorage.removeItem(LEGACY_DECK_SESSION_STORAGE_KEY)
    }
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}
