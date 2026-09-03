import { getDeckPersistenceController, type DeckDocumentActions } from './deck-persistence.ts'

export function useDeckDocumentActions(): DeckDocumentActions {
  const controller = getDeckPersistenceController()

  return {
    deleteActiveDeck: controller.deleteActiveDeck,
    patchDeckOperations: controller.patchDeckOperations,
    renameActiveDeck: controller.renameActiveDeck,
    restoreFromHistory: controller.restoreFromHistory,
    restoreHtmlSnapshot: controller.restoreHtmlSnapshot,
  }
}
