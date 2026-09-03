import { useDeckStore } from '@/state/deck-store.ts'
import type { createDeck } from '@/lib/api/deck-api'

type DeckStoreApi = ReturnType<typeof useDeckStore.getState>

export const store = (): DeckStoreApi => useDeckStore.getState()

export type PersistenceSession = {
  saveRequestId: number
  patchRequestId: number
  manualMutationQueue: Promise<void> | null
  newDeckPromise: ReturnType<typeof createDeck> | null
}

export function createPersistenceSession(): PersistenceSession {
  return {
    saveRequestId: 0,
    patchRequestId: 0,
    manualMutationQueue: null,
    newDeckPromise: null,
  }
}
