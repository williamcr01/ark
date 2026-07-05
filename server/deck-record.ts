export type DeckVersionSource = 'manual' | 'agent' | 'upload' | 'repair' | 'rollback'

export type DeckValidationStatus = 'unknown' | 'valid' | 'invalid'

export type DeckVersionOptions = {
  source?: DeckVersionSource
  summary?: string | null
  modelProvider?: string | null
  modelName?: string | null
  validationStatus?: DeckValidationStatus
}

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

export type DeckVersionSummary = {
  id: string
  deckId: string
  versionNumber: number
  title: string
  source: DeckVersionSource
  summary: string | null
  validationStatus: DeckValidationStatus
  createdAt: string
  isActive: boolean
}

export type DeckVersionDetail = DeckVersionSummary & {
  html: string
}

export type DeckStore = {
  createDeck: (html: string, options?: DeckVersionOptions) => Promise<StoredDeck>
  getDeck: (id: string) => Promise<StoredDeck | null>
  listDecks: () => Promise<DeckSummary[]>
  updateDeck: (id: string, html: string, options?: DeckVersionOptions) => Promise<StoredDeck | null>
  updateDeckMetadata: (id: string, metadata: { title?: string }) => Promise<StoredDeck | null>
  deleteDeck: (id: string) => Promise<boolean>
  listVersions: (deckId: string) => Promise<DeckVersionSummary[] | null>
  getVersion: (deckId: string, versionId: string) => Promise<DeckVersionDetail | null>
  rollbackToVersion: (deckId: string, versionId: string) => Promise<StoredDeck | null>
}

const DECK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidDeckId(id: string) {
  return DECK_ID_PATTERN.test(id)
}

export function extractDeckTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)

  return normalizeDeckTitle(match?.[1])
}

export function normalizeDeckTitle(title: unknown) {
  return typeof title === 'string' && title.trim() ? title.trim() : 'Untitled deck'
}

export function normalizeDeckVersionSource(source: unknown): DeckVersionSource {
  if (
    source === 'agent' ||
    source === 'upload' ||
    source === 'repair' ||
    source === 'rollback' ||
    source === 'manual'
  ) {
    return source
  }

  return 'manual'
}

export function normalizeDeckValidationStatus(status: unknown): DeckValidationStatus {
  if (status === 'valid' || status === 'invalid' || status === 'unknown') {
    return status
  }

  return 'unknown'
}
