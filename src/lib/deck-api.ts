export type StoredDeck = {
  id: string
  html: string
  title: string
  createdAt: string
  updatedAt: string
}

export type DeckSummary = Omit<StoredDeck, 'html'>

type DeckResponse = {
  deck?: StoredDeck
  error?: string
}

type DeckListResponse = {
  decks?: DeckSummary[]
  error?: string
}

async function readDeckResponse(response: Response) {
  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as DeckResponse

  if (!response.ok || !data.deck) {
    throw new Error(data.error ?? 'Could not load the deck.')
  }

  return data.deck
}

async function readDeckListResponse(response: Response) {
  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as DeckListResponse

  if (!response.ok || !Array.isArray(data.decks)) {
    throw new Error(data.error ?? 'Could not load decks.')
  }

  return data.decks
}

export async function listDecks() {
  const response = await fetch('/api/decks')
  return readDeckListResponse(response)
}

export async function fetchDeck(id: string) {
  const response = await fetch(`/api/decks/${encodeURIComponent(id)}`)
  return readDeckResponse(response)
}

export async function createDeck(html: string) {
  const response = await fetch('/api/decks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html }),
  })

  return readDeckResponse(response)
}

export async function updateDeck(id: string, html: string) {
  const response = await fetch(`/api/decks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html }),
  })

  return readDeckResponse(response)
}

export async function renameDeck(id: string, title: string) {
  const response = await fetch(`/api/decks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })

  return readDeckResponse(response)
}

export async function deleteDeck(id: string) {
  const response = await fetch(`/api/decks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })

  if (response.status === 204) {
    return
  }

  const data = (await response.json().catch(() => ({
    error: 'The API returned an unreadable response.',
  }))) as DeckResponse

  throw new Error(data.error ?? 'Could not delete the deck.')
}
