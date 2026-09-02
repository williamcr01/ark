import type { PatchDeckResponse } from '@/lib/api/deck-api'
import { selectHasDeck, selectIsDirty, useDeckStore } from '@/state/deck-store.ts'

import { createBoot } from './deck-persistence-boot.ts'
import { createDocumentActions } from './deck-persistence-documents.ts'
import { createLifecycleActions, NEW_DECK_HTML } from './deck-persistence-lifecycle.ts'
import { createPersistenceSession, store } from './deck-persistence-session.ts'

export { NEW_DECK_HTML }

export type DeckPersistenceController = {
  applyPatchedDeck: (patchResult: PatchDeckResponse) => number | undefined
  boot: ReturnType<typeof createBoot>
} & ReturnType<typeof createLifecycleActions> &
  ReturnType<typeof createDocumentActions>

export type DeckPersistenceActions = Pick<
  DeckPersistenceController,
  | 'duplicate'
  | 'ensureBlankDeck'
  | 'moveTo'
  | 'openWorkspaceFile'
  | 'persistHtml'
  | 'refreshActiveDeck'
  | 'saveAs'
  | 'selectDeck'
  | 'startNewDeck'
>

export type DeckDocumentActions = Pick<
  DeckPersistenceController,
  | 'deleteActiveDeck'
  | 'patchDeckOperations'
  | 'renameActiveDeck'
  | 'restoreFromHistory'
  | 'restoreHtmlSnapshot'
>

let sharedController: DeckPersistenceController | null = null

export function getDeckPersistenceController() {
  sharedController ??= createDeckPersistenceController()
  return sharedController
}

export function resetDeckPersistenceController() {
  sharedController = null
}

export function createDeckPersistenceController(): DeckPersistenceController {
  const session = createPersistenceSession()
  const lifecycle = createLifecycleActions(session)
  const documents = createDocumentActions(session, lifecycle.refreshActiveDeck)

  return {
    applyPatchedDeck: (patchResult) => store().applyPatchedDeck(patchResult),
    boot: createBoot(session),
    ...lifecycle,
    ...documents,
  }
}

export function selectDeckPersistenceSnapshot(state: ReturnType<typeof useDeckStore.getState>) {
  return {
    documentRevision: state.documentRevision,
    deckId: state.deckId,
    deckTitle: state.deckTitle,
    origin: state.origin,
    decks: state.decks,
    hasDeck: selectHasDeck(state),
    html: state.html,
    filePath: state.filePath,
    isDirty: selectIsDirty(state),
    isLoading: state.isLoading,
    isPatching: state.isPatching,
    isSaving: state.isSaving,
    saveError: state.saveError,
  }
}

export type DeckPersistenceSnapshot = ReturnType<typeof selectDeckPersistenceSnapshot>

export type WorkspacePersistence = DeckPersistenceSnapshot &
  DeckPersistenceActions &
  DeckDocumentActions
