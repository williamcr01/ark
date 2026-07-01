export type StoredDeck = {
  id: string
  html: string
  title: string
  createdAt: string
  updatedAt: string
  activeVersionId?: string | null
  versionNumber?: number | null
}

export type DeckSummary = Omit<StoredDeck, 'html'>

export type DeckStore = {
  createDeck: (html: string) => Promise<StoredDeck>
  getDeck: (id: string) => Promise<StoredDeck | null>
  listDecks: () => Promise<DeckSummary[]>
  updateDeck: (id: string, html: string) => Promise<StoredDeck | null>
  deleteDeck: (id: string) => Promise<boolean>
}

const DECK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidDeckId(id: string) {
  return DECK_ID_PATTERN.test(id)
}

export function extractDeckTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = match?.[1]?.trim()

  return title || 'Untitled deck'
}
