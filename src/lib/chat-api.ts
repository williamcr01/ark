import type {
  AppendChatMessageRequest,
  DeckChatResponse,
  PersistedChatMessage,
} from '../../shared/chat-thread.ts'

type DeckChatApiResponse = DeckChatResponse & {
  error?: string
}

type AppendChatMessageResponse = {
  message?: PersistedChatMessage
  error?: string
}

async function readDeckChatResponse(response: Response) {
  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as DeckChatApiResponse

  if (!response.ok || !Array.isArray(data.messages)) {
    throw new Error(data.error ?? 'Could not load deck chat.')
  }

  return data
}

async function readAppendMessageResponse(response: Response) {
  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as AppendChatMessageResponse

  if (!response.ok || !data.message) {
    throw new Error(data.error ?? 'Could not save chat message.')
  }

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
