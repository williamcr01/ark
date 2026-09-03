import { useEffect } from 'react'

import { getDeckPersistenceController, type DeckPersistenceActions } from './deck-persistence.ts'

export type {
  DeckPersistenceActions,
  DeckDocumentActions,
  WorkspacePersistence,
} from './deck-persistence.ts'

/**
 * @param routeDeckId Deck id from `/decks/:deckId`, or `null` on `/` until the
 * first prompt creates a blank workspace.
 */
export function useDeckPersistence(routeDeckId: string | null = null): DeckPersistenceActions {
  const controller = getDeckPersistenceController()

  useEffect(() => controller.boot(routeDeckId), [controller, routeDeckId])

  return {
    duplicate: controller.duplicate,
    ensureBlankDeck: controller.ensureBlankDeck,
    moveTo: controller.moveTo,
    openWorkspaceFile: controller.openWorkspaceFile,
    persistHtml: controller.persistHtml,
    refreshActiveDeck: controller.refreshActiveDeck,
    saveAs: controller.saveAs,
    selectDeck: controller.selectDeck,
    startNewDeck: controller.startNewDeck,
  }
}
