import type { DeckRuntimeManifest } from '../shared/deck-runtime-manifest.ts'

export type {
  DeckSummary,
  DeckValidationStatus,
  DeckVersionDetail,
  DeckVersionSource,
  DeckVersionSummary,
  StoredDeck,
} from '../shared/api/decks.ts'

export type { DeckVersionOptions as DeckVersionRequestOptions } from '../shared/api/decks.ts'

export {
  isValidDeckId,
  normalizeDeckTitle,
  normalizeDeckVersionSource,
} from '../shared/api/decks.ts'

import type {
  DeckSummary,
  DeckValidationStatus,
  DeckVersionDetail,
  DeckVersionSummary,
  StoredDeck,
} from '../shared/api/decks.ts'
import type { DeckVersionOptions as SharedDeckVersionOptions } from '../shared/api/decks.ts'
import { normalizeDeckTitle } from '../shared/api/decks.ts'

export type DeckVersionOptions = SharedDeckVersionOptions & {
  validationStatus?: DeckValidationStatus
  runtimeManifest?: DeckRuntimeManifest
  validationReport?: Record<string, unknown>
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

export function extractDeckTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)

  return normalizeDeckTitle(match?.[1])
}

export function normalizeDeckValidationStatus(
  status: unknown,
): import('../shared/api/decks.ts').DeckValidationStatus {
  if (status === 'valid' || status === 'invalid' || status === 'unknown') {
    return status
  }

  return 'unknown'
}
