import type { ChatMessage } from '@ark/deck-core/chat.ts'

const CHAT_SESSION_STORAGE_PREFIX = 'ark:chat-session:'

export type ChatSession = {
  messages: ChatMessage[]
  updatedAt: string
  /** Message ids that failed to persist to the server (local cache metadata only). */
  failedPersistIds?: string[]
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

const readFailedPersistIds = (parsed: { failedPersistIds?: unknown }): string[] | undefined => {
  const ids = parsed.failedPersistIds

  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    return undefined
  }

  return ids
}

const parseStoredSession = (raw: string | null): ChatSession | null => {
  if (!raw) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)

    if (isChatSession(parsed)) {
      return {
        ...parsed,
        failedPersistIds: readFailedPersistIds(parsed),
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
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}
