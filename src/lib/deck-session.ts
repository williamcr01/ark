import type { ChatMessage } from '../../shared/chat.ts'

const DECK_SESSION_STORAGE_KEY = 'ark:deck-session'

export type DeckSession = {
  id: string
  html: string
  messages: ChatMessage[]
  updatedAt: string
}

const isChatMessage = (value: unknown): value is ChatMessage =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ChatMessage).id === 'string' &&
  ((value as ChatMessage).role === 'user' ||
    (value as ChatMessage).role === 'assistant') &&
  typeof (value as ChatMessage).content === 'string'

const isDeckSession = (value: unknown): value is DeckSession =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as DeckSession).id === 'string' &&
  typeof (value as DeckSession).html === 'string' &&
  Array.isArray((value as DeckSession).messages) &&
  (value as DeckSession).messages.every(isChatMessage) &&
  typeof (value as DeckSession).updatedAt === 'string'

export const createDeckSession = (): DeckSession => ({
  id: crypto.randomUUID(),
  html: '',
  messages: [],
  updatedAt: new Date().toISOString(),
})

export const readDeckSession = (): DeckSession | null => {
  try {
    const raw = localStorage.getItem(DECK_SESSION_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed: unknown = JSON.parse(raw)
    return isDeckSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const writeDeckSession = (session: DeckSession) => {
  try {
    localStorage.setItem(
      DECK_SESSION_STORAGE_KEY,
      JSON.stringify({
        ...session,
        updatedAt: new Date().toISOString(),
      }),
    )
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}

export const clearDeckSession = () => {
  try {
    localStorage.removeItem(DECK_SESSION_STORAGE_KEY)
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}
