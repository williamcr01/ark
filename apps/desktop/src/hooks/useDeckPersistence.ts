import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useDeckStore } from '@/state/deck-store.ts'

import {
  createDeckPersistenceController,
  selectDeckPersistenceSnapshot,
  type DeckPersistenceController,
} from './deck-persistence.ts'

/**
 * @param routeDeckId Deck id from `/decks/:deckId`, or `null` on `/` until the
 * first prompt creates a blank workspace.
 */
export function useDeckPersistence(routeDeckId: string | null = null) {
  const controllerRef = useRef<DeckPersistenceController | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = createDeckPersistenceController()
  }
  const controller = controllerRef.current

  useEffect(() => controller.boot(routeDeckId), [controller, routeDeckId])

  const snapshot = useDeckStore(useShallow(selectDeckPersistenceSnapshot))

  return {
    ...snapshot,
    duplicate: controller.duplicate,
    deleteActiveDeck: controller.deleteActiveDeck,
    ensureBlankDeck: controller.ensureBlankDeck,
    patchDeckOperations: controller.patchDeckOperations,
    persistHtml: controller.persistHtml,
    moveTo: controller.moveTo,
    openWorkspaceFile: controller.openWorkspaceFile,
    refreshActiveDeck: controller.refreshActiveDeck,
    renameActiveDeck: controller.renameActiveDeck,
    restoreFromHistory: controller.restoreFromHistory,
    restoreHtmlSnapshot: controller.restoreHtmlSnapshot,
    saveAs: controller.saveAs,
    selectDeck: controller.selectDeck,
    startNewDeck: controller.startNewDeck,
  }
}
