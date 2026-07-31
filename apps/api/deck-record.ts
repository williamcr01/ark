import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'

export type {
  DeckSummary,
  DeckValidationStatus,
  DeckVersionDetail,
  DeckVersionSource,
  DeckVersionSummary,
  StoredDeck,
} from '@ark/contracts'

export type { DeckVersionOptions as DeckVersionRequestOptions } from '@ark/contracts'

export {
  isValidDeckId,
  normalizeDeckTitle,
  normalizeDeckVersionSource,
  extractDeckTitle,
} from '@ark/contracts'

import type {
  DeckSummary,
  DeckValidationStatus,
  DeckVersionDetail,
  DeckVersionSummary,
  StoredDeck,
  DeckVersionOptions as SharedDeckVersionOptions,
} from '@ark/contracts'

export type DeckVersionOptions = SharedDeckVersionOptions & {
  validationStatus?: DeckValidationStatus
  runtimeManifest?: DeckRuntimeManifest
  validationReport?: Record<string, unknown>
  diff?: import('@ark/contracts').DeckVersionDiff
}

export type DeckStore = {
  createDeck: (html: string, options?: DeckVersionOptions, id?: string) => Promise<StoredDeck>
  getDeck: (id: string) => Promise<StoredDeck | null>
  listDecks: () => Promise<DeckSummary[]>
  updateDeck: (id: string, html: string, options?: DeckVersionOptions) => Promise<StoredDeck | null>
  updateDeckMetadata: (id: string, metadata: { title?: string }) => Promise<StoredDeck | null>
  deleteDeck: (id: string) => Promise<boolean>
  listVersions: (deckId: string) => Promise<DeckVersionSummary[] | null>
  getVersionMetadata: (deckId: string, versionId: string) => Promise<DeckVersionSummary | null>
  getVersion: (deckId: string, versionId: string) => Promise<DeckVersionDetail | null>
  rollbackToVersion: (
    deckId: string,
    versionId: string,
    options?: DeckVersionOptions,
  ) => Promise<StoredDeck | null>
}

export function normalizeDeckValidationStatus(
  status: unknown,
): import('@ark/contracts').DeckValidationStatus {
  if (status === 'valid' || status === 'invalid' || status === 'unknown') {
    return status
  }

  return 'unknown'
}
