import type { EmbeddedAsset } from './embedded-assets.ts'

export type { DeckSummary, StoredDeck, DeckOrigin } from '@ark/contracts'

export { isValidDeckId, normalizeDeckTitle, extractDeckTitle } from '@ark/contracts'

import type { DeckOrigin, DeckSummary, StoredDeck } from '@ark/contracts'

export type DeckSaveOptions = {
  embeddedAssets?: EmbeddedAsset[]
  /** Only honored on create; writes flip `blank` to `authored` on their own. */
  origin?: DeckOrigin
}

export type DeckUpdateOptions = DeckSaveOptions & {
  expectedDocumentRevision: number
}

export type DeckStore = {
  createDeck: (html: string, options?: DeckSaveOptions, id?: string) => Promise<StoredDeck>
  getDeck: (id: string) => Promise<StoredDeck | null>
  listDecks: () => Promise<DeckSummary[]>
  updateDeck: (id: string, html: string, options: DeckUpdateOptions) => Promise<StoredDeck | null>
  updateDeckMetadata: (id: string, metadata: { title?: string }) => Promise<StoredDeck | null>
  deleteDeck: (id: string) => Promise<boolean>
}
