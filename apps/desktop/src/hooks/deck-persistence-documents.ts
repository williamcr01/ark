import {
  deleteDeck,
  patchDeck,
  renameDeck,
  restoreDocumentHistory,
  updateDeck,
  type PatchDeckResponse,
  type StoredDeck,
} from '@/lib/api/deck-api'
import type { DeckPatchOperation } from '@ark/deck/patch/patch-request.ts'
import { ApiResponseError } from '@ark/contracts'

import { store, type PersistenceSession } from './deck-persistence-session.ts'

type RefreshActiveDeck = (targetDeckId?: string) => Promise<StoredDeck | null>

export function createDocumentActions(
  session: PersistenceSession,
  refreshActiveDeck: RefreshActiveDeck,
) {
  const renameActiveDeck = async (title: string) => {
    const { deckId } = store()
    if (!deckId) {
      return
    }

    store().setSaving(true)
    store().setSaveError('')

    try {
      const deck = await renameDeck(deckId, title)

      store().applySavedDeck(deck, { replaceHtml: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not rename the deck.'

      store().setSaveError(message)
      throw error
    } finally {
      store().setSaving(false)
    }
  }

  const deleteActiveDeck = async () => {
    const { deckId } = store()
    if (!deckId) {
      store().clearActiveDeck()
      return
    }

    const deletedDeckId = deckId

    session.saveRequestId += 1
    store().setSaving(true)
    store().setSaveError('')

    try {
      await deleteDeck(deletedDeckId)
      store().setDecks((currentDecks) => currentDecks.filter((deck) => deck.id !== deletedDeckId))
      store().clearActiveDeck()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not delete the deck.'

      store().setSaveError(message)
      throw error
    } finally {
      store().setSaving(false)
    }
  }

  return {
    renameActiveDeck,
    deleteActiveDeck,
    restoreHtmlSnapshot: createRestoreHtmlSnapshot(session),
    patchDeckOperations: createPatchDeckOperations(session),
    restoreFromHistory: createRestoreFromHistory(session, refreshActiveDeck),
  }
}

function enqueueManualMutation<T>(session: PersistenceSession, mutation: () => Promise<T>) {
  const previous = session.manualMutationQueue
  const result = previous ? previous.then(mutation, mutation) : mutation()
  const settled = result.then(
    () => undefined,
    () => undefined,
  )
  session.manualMutationQueue = settled
  void settled.then(() => {
    if (session.manualMutationQueue === settled) {
      session.manualMutationQueue = null
    }
  })
  return result
}

function createRestoreHtmlSnapshot(session: PersistenceSession) {
  return (nextHtml: string) => {
    const sessionId = session.saveRequestId

    return enqueueManualMutation(session, async () => {
      const { deckId } = store()
      if (!deckId) {
        throw new Error('Save the deck before editing.')
      }

      if (sessionId !== session.saveRequestId) {
        return undefined
      }

      const requestId = ++session.patchRequestId

      store().setPatching(true)
      store().setSaveError('')

      try {
        const deck = await updateDeck(deckId, nextHtml, store().documentRevision!)
        if (sessionId === session.saveRequestId && requestId === session.patchRequestId) {
          store().applySavedDeck(deck, { replaceHtml: true })
          return deck
        }
        return undefined
      } catch (error) {
        if (sessionId !== session.saveRequestId || requestId !== session.patchRequestId) {
          return undefined
        }

        const message = error instanceof Error ? error.message : 'Could not update the deck.'

        store().setSaveError(message)
        throw error
      } finally {
        if (requestId === session.patchRequestId) {
          store().setPatching(false)
        }
      }
    })
  }
}

function createPatchDeckOperations(session: PersistenceSession) {
  const applyPatchedDeck = (patchResult: PatchDeckResponse) => store().applyPatchedDeck(patchResult)

  return (operations: DeckPatchOperation[], activeSlideIndex?: number) => {
    const sessionId = session.saveRequestId

    return enqueueManualMutation(session, async () => {
      const { deckId } = store()
      if (!deckId) {
        throw new Error('Save the deck before editing.')
      }

      if (sessionId !== session.saveRequestId) {
        return undefined
      }

      const requestId = ++session.patchRequestId
      const beforeHtml = store().html

      store().setPatching(true)
      store().setSaveError('')

      try {
        const patchResult = await patchDeck(deckId, {
          operations,
          activeSlideIndex,
          expectedDocumentRevision: store().documentRevision!,
        })
        if (sessionId === session.saveRequestId && requestId === session.patchRequestId) {
          const suggestedSlideIndex = applyPatchedDeck(patchResult)
          return { ...patchResult, suggestedSlideIndex, beforeHtml }
        }
        return undefined
      } catch (error) {
        if (sessionId !== session.saveRequestId || requestId !== session.patchRequestId) {
          return undefined
        }

        const message = error instanceof Error ? error.message : 'Could not patch the deck.'

        store().setSaveError(message)
        throw error
      } finally {
        if (requestId === session.patchRequestId) {
          store().setPatching(false)
        }
      }
    })
  }
}

function createRestoreFromHistory(
  session: PersistenceSession,
  refreshActiveDeck: RefreshActiveDeck,
) {
  return (historyRevision: number) => {
    const { deckId } = store()
    if (!deckId) {
      throw new Error('Save the deck before restoring.')
    }

    const sessionId = session.saveRequestId

    return enqueueManualMutation(session, async () => {
      if (sessionId !== session.saveRequestId) {
        return undefined
      }

      const expectedDocumentRevision = store().documentRevision
      if (!expectedDocumentRevision) {
        throw new Error('Save the deck before restoring.')
      }

      const requestId = ++session.patchRequestId
      store().setPatching(true)
      store().setSaveError('')

      try {
        const deck = await restoreDocumentHistory(deckId, {
          revision: historyRevision,
          expectedDocumentRevision,
        })
        if (sessionId === session.saveRequestId && requestId === session.patchRequestId) {
          store().setActiveDeck(deck)
          return deck
        }
        return undefined
      } catch (error) {
        if (sessionId !== session.saveRequestId || requestId !== session.patchRequestId) {
          return undefined
        }

        if (error instanceof ApiResponseError && error.code === 'document_conflict') {
          await refreshActiveDeck()
        }

        const message = error instanceof Error ? error.message : 'Could not restore that version.'
        store().setSaveError(message)
        throw error
      } finally {
        if (requestId === session.patchRequestId) {
          store().setPatching(false)
        }
      }
    })
  }
}
