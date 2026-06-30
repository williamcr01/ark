export type StoredDeck = {
  id: string
  html: string
  title: string
  createdAt: string
  updatedAt: string
}

type DeckResponse = {
  deck?: StoredDeck
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
