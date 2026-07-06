import type { AppendChatMessageRequest } from '../../shared/chat-thread.ts'
import { CHAT_HISTORY_PAGE_SIZE } from '../../shared/chat-thread.ts'
import {
  appendChatMessageResponseSchema,
  deckChatResponseSchema,
  type DeckChatResponse,
  type PersistedChatMessage,
} from '../../shared/api/chat.ts'
import { fetchApiJsonOrThrow } from '../../shared/api/fetch.ts'

export type { DeckChatResponse, PersistedChatMessage }

async function readDeckChatResponse(response: Response) {
  return fetchApiJsonOrThrow(response, deckChatResponseSchema, {
    fallbackMessage: 'Could not load deck chat.',
  })
}

async function readAppendMessageResponse(response: Response) {
  const data = await fetchApiJsonOrThrow(response, appendChatMessageResponseSchema, {
    fallbackMessage: 'Could not save chat message.',
  })
  return data.message
}

export async function fetchDeckChat(
  deckId: string,
  options?: { limit?: number; before?: string },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams()

  if (options?.limit) {
    params.set('limit', String(options.limit))
  }

  if (options?.before) {
    params.set('before', options.before)
  }

  const query = params.toString()
  const response = await fetch(
    `/api/decks/${encodeURIComponent(deckId)}/chat${query ? `?${query}` : ''}`,
    { signal },
  )

  return readDeckChatResponse(response)
}

export async function fetchAllDeckChat(deckId: string, signal?: AbortSignal) {
  let thread: DeckChatResponse['thread'] = null
  let messages: PersistedChatMessage[] = []
  let before: string | undefined

  while (true) {
    const page = await fetchDeckChat(
      deckId,
      {
        limit: CHAT_HISTORY_PAGE_SIZE,
        before,
      },
      signal,
    )

    thread = page.thread ?? thread

    if (page.messages.length === 0) {
      break
    }

    messages = [...page.messages, ...messages]

    if (!page.hasMore) {
      break
    }

    before = page.messages[0]?.id
  }

  return {
    thread,
    messages,
    hasMore: false,
  }
}

export async function appendDeckChatMessage(
  deckId: string,
  message: AppendChatMessageRequest,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
    signal,
  })

  return readAppendMessageResponse(response)
}

export async function clearDeckChat(deckId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/chat`, {
    method: 'DELETE',
    signal,
  })

  if (!response.ok && response.status !== 204) {
    const data = (await response.json().catch(() => ({ error: 'Could not clear deck chat.' }))) as {
      error?: string
    }

    throw new Error(data.error ?? 'Could not clear deck chat.')
  }
}
