import { Router } from 'express'

import type { AssetStore } from '@ark/storage/records/asset-record.ts'
import type { DeckStore } from '@ark/storage/records/deck-record.ts'
import { registerDeckMetaRoutes } from './decks-meta.ts'
import { registerDeckPatchRoute } from './decks-patch.ts'
import { registerDeckReadRoutes } from './decks-read.ts'
import { registerDeckWriteRoutes } from './decks-write.ts'

export function createDecksRouter(deps: {
  deckStore: DeckStore
  assetStore: AssetStore
  onDocumentPersisted?: (deckId: string, documentRevision: number) => void
  onEditorPatchPersisted?: (deckId: string, documentRevision: number) => void
}): Router {
  const router = Router()
  registerDeckReadRoutes(router, deps)
  registerDeckWriteRoutes(router, deps)
  registerDeckPatchRoute(router, deps)
  registerDeckMetaRoutes(router, deps)
  return router
}
