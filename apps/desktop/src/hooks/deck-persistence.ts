import {
  createDeck,
  deleteDeck,
  fetchDeck,
  listDecks,
  moveWorkspace,
  openWorkspace,
  patchDeck,
  renameDeck,
  restoreDocumentHistory,
  saveWorkspaceAs,
  duplicateWorkspace,
  updateDeck,
  type PatchDeckResponse,
  type StoredDeck,
} from '@/lib/api/deck-api'
import type { DeckPatchOperation } from '@ark/deck/patch/patch-request.ts'
import { ApiResponseError, extractDeckTitle } from '@ark/contracts'
import { selectHasDeck, selectIsDirty, useDeckStore } from '@/state/deck-store.ts'

/** A blank white slide: no starter content, so the first edit or generation owns the deck. */
export const NEW_DECK_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Untitled Presentation</title><style>html,body{margin:0}body{font-family:system-ui,sans-serif}.slide{box-sizing:border-box;width:100vw;height:100vh;padding:8%;background:#fff;color:#171717}</style></head><body><section class="slide"></section></body></html>`

type DeckStoreApi = ReturnType<typeof useDeckStore.getState>

const store = (): DeckStoreApi => useDeckStore.getState()

export type DeckPersistenceController = {
  applyPatchedDeck: (patchResult: PatchDeckResponse) => number | undefined
  boot: (routeDeckId: string | null) => () => void
  deleteActiveDeck: () => Promise<void>
  duplicate: (
    mode: 'presentation' | 'complete',
    path?: string,
    overwrite?: boolean,
  ) => ReturnType<typeof duplicateWorkspace>
  ensureBlankDeck: () => Promise<string | null>
  moveTo: (path: string, overwrite?: boolean) => Promise<StoredDeck>
  openWorkspaceFile: (path: string) => Promise<StoredDeck>
  patchDeckOperations: (
    operations: DeckPatchOperation[],
    activeSlideIndex?: number,
  ) => Promise<
    | (PatchDeckResponse & { suggestedSlideIndex: number | undefined; beforeHtml: string })
    | undefined
  >
  persistHtml: (nextHtml: string) => Promise<StoredDeck | undefined>
  refreshActiveDeck: (targetDeckId?: string) => Promise<StoredDeck | null>
  renameActiveDeck: (title: string) => Promise<void>
  restoreFromHistory: (historyRevision: number) => Promise<StoredDeck | undefined>
  restoreHtmlSnapshot: (nextHtml: string) => Promise<StoredDeck | undefined>
  saveAs: (path: string, overwrite?: boolean) => Promise<StoredDeck>
  selectDeck: (nextDeckId: string) => Promise<void>
  startNewDeck: () => Promise<void>
}

export function createDeckPersistenceController(): DeckPersistenceController {
  let saveRequestId = 0
  let patchRequestId = 0
  let manualMutationQueue: Promise<void> | null = null
  let newDeckPromise: ReturnType<typeof createDeck> | null = null

  const applyPatchedDeck = (patchResult: PatchDeckResponse) => store().applyPatchedDeck(patchResult)

  const persistHtml = async (nextHtml: string) => {
    const requestId = ++saveRequestId
    const { deckId, deckTitle, html, savedHtml } = store()

    store().setHtml(nextHtml)
    const previousExtracted = extractDeckTitle(savedHtml || html)
    if (!deckId || !deckTitle || deckTitle === previousExtracted) {
      store().setDeckTitle(extractDeckTitle(nextHtml))
    }
    store().setSaving(true)
    store().setSaveError('')

    try {
      const deck = deckId
        ? await updateDeck(deckId, nextHtml, store().documentRevision!)
        : await createDeck(nextHtml)

      if (requestId !== saveRequestId) {
        return undefined
      }

      store().applySavedDeck(deck)
      return deck
    } catch (error) {
      if (requestId !== saveRequestId) {
        return undefined
      }

      const message = error instanceof Error ? error.message : 'Could not save the deck.'

      store().setSaveError(message)
      throw error
    } finally {
      store().setSaving((current) => (requestId === saveRequestId ? false : current))
    }
  }

  const selectDeck = async (nextDeckId: string) => {
    if (nextDeckId === store().deckId) {
      return
    }

    const requestId = ++saveRequestId

    store().setLoading(true)
    store().setSaveError('')

    try {
      const deck = await fetchDeck(nextDeckId)

      if (requestId !== saveRequestId) {
        return
      }

      store().setActiveDeck(deck)
    } catch (error) {
      if (requestId !== saveRequestId) {
        return
      }

      const message = error instanceof Error ? error.message : 'Could not load the deck.'

      store().setSaveError(message)
      throw error
    } finally {
      store().setLoading((current) => (requestId === saveRequestId ? false : current))
    }
  }

  const startNewDeck = async () => {
    saveRequestId += 1
    store().setSaving(false)
    store().setSaveError('')
    newDeckPromise = null
    store().clearActiveDeck()
  }

  const ensureBlankDeck = async () => {
    if (store().deckId) {
      return store().deckId
    }

    const requestId = saveRequestId
    const promise = (newDeckPromise ??= createDeck(NEW_DECK_HTML, 'blank'))
    const deck = await promise

    if (saveRequestId !== requestId) {
      return store().deckId
    }

    store().setActiveDeck(deck)
    return deck.id
  }

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

    saveRequestId += 1
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

  const applyWorkspaceAction = async (action: () => Promise<StoredDeck>) => {
    store().setSaving(true)
    try {
      const deck = await action()
      store().setActiveDeck(deck)
      return deck
    } finally {
      store().setSaving(false)
    }
  }

  const openWorkspaceFile = (path: string) => applyWorkspaceAction(() => openWorkspace(path))

  const saveAs = (path: string, overwrite = false) => {
    const { deckId } = store()
    if (!deckId) throw new Error('No workspace is open.')
    return applyWorkspaceAction(() => saveWorkspaceAs(deckId, path, overwrite))
  }

  const moveTo = (path: string, overwrite = false) => {
    const { deckId } = store()
    if (!deckId) throw new Error('No workspace is open.')
    return applyWorkspaceAction(() => moveWorkspace(deckId, path, overwrite))
  }

  const duplicate = (mode: 'presentation' | 'complete', path?: string, overwrite = false) => {
    const { deckId } = store()
    if (!deckId) throw new Error('No workspace is open.')
    return duplicateWorkspace(deckId, mode, path, overwrite)
  }

  const refreshActiveDeck = async (targetDeckId?: string) => {
    const resolvedDeckId = targetDeckId ?? store().deckId

    if (!resolvedDeckId) {
      return null
    }

    const requestId = ++saveRequestId

    try {
      const deck = await fetchDeck(resolvedDeckId)

      if (requestId !== saveRequestId || resolvedDeckId !== store().deckId) {
        return null
      }

      store().setActiveDeck(deck)
      return deck
    } catch (error) {
      if (requestId !== saveRequestId) {
        return null
      }

      const message = error instanceof Error ? error.message : 'Could not refresh the deck.'

      store().setSaveError(message)
      throw error
    }
  }

  const enqueueManualMutation = <T>(mutation: () => Promise<T>) => {
    const previous = manualMutationQueue
    const result = previous ? previous.then(mutation, mutation) : mutation()
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    manualMutationQueue = settled
    void settled.then(() => {
      if (manualMutationQueue === settled) {
        manualMutationQueue = null
      }
    })
    return result
  }

  const restoreHtmlSnapshot = (nextHtml: string) => {
    const sessionId = saveRequestId

    return enqueueManualMutation(async () => {
      const { deckId } = store()
      if (!deckId) {
        throw new Error('Save the deck before editing.')
      }

      if (sessionId !== saveRequestId) {
        return undefined
      }

      const requestId = ++patchRequestId

      store().setPatching(true)
      store().setSaveError('')

      try {
        const deck = await updateDeck(deckId, nextHtml, store().documentRevision!)

        if (sessionId !== saveRequestId || requestId !== patchRequestId) {
          return undefined
        }

        store().applySavedDeck(deck, { replaceHtml: true })
        return deck
      } catch (error) {
        if (sessionId !== saveRequestId || requestId !== patchRequestId) {
          return undefined
        }

        const message = error instanceof Error ? error.message : 'Could not update the deck.'

        store().setSaveError(message)
        throw error
      } finally {
        if (requestId === patchRequestId) {
          store().setPatching(false)
        }
      }
    })
  }

  const patchDeckOperations = (operations: DeckPatchOperation[], activeSlideIndex?: number) => {
    const sessionId = saveRequestId

    return enqueueManualMutation(async () => {
      const { deckId } = store()
      if (!deckId) {
        throw new Error('Save the deck before editing.')
      }

      if (sessionId !== saveRequestId) {
        return undefined
      }

      const requestId = ++patchRequestId
      const beforeHtml = store().html

      store().setPatching(true)
      store().setSaveError('')

      try {
        const patchResult = await patchDeck(deckId, {
          operations,
          activeSlideIndex,
          expectedDocumentRevision: store().documentRevision!,
        })

        if (sessionId !== saveRequestId || requestId !== patchRequestId) {
          return undefined
        }

        const suggestedSlideIndex = applyPatchedDeck(patchResult)
        return { ...patchResult, suggestedSlideIndex, beforeHtml }
      } catch (error) {
        if (sessionId !== saveRequestId || requestId !== patchRequestId) {
          return undefined
        }

        const message = error instanceof Error ? error.message : 'Could not patch the deck.'

        store().setSaveError(message)
        throw error
      } finally {
        if (requestId === patchRequestId) {
          store().setPatching(false)
        }
      }
    })
  }

  const restoreFromHistory = (historyRevision: number) => {
    const { deckId } = store()
    if (!deckId) {
      throw new Error('Save the deck before restoring.')
    }

    const sessionId = saveRequestId

    return enqueueManualMutation(async () => {
      if (sessionId !== saveRequestId) {
        return undefined
      }

      const expectedDocumentRevision = store().documentRevision
      if (!expectedDocumentRevision) {
        throw new Error('Save the deck before restoring.')
      }

      const requestId = ++patchRequestId
      store().setPatching(true)
      store().setSaveError('')

      try {
        const deck = await restoreDocumentHistory(deckId, {
          revision: historyRevision,
          expectedDocumentRevision,
        })

        if (sessionId !== saveRequestId || requestId !== patchRequestId) {
          return undefined
        }

        store().setActiveDeck(deck)
        return deck
      } catch (error) {
        if (sessionId !== saveRequestId || requestId !== patchRequestId) {
          return undefined
        }

        if (error instanceof ApiResponseError && error.code === 'document_conflict') {
          await refreshActiveDeck()
        }

        const message = error instanceof Error ? error.message : 'Could not restore that version.'
        store().setSaveError(message)
        throw error
      } finally {
        if (requestId === patchRequestId) {
          store().setPatching(false)
        }
      }
    })
  }

  const boot = (routeDeckId: string | null) => {
    let cancelled = false
    const deck = store()

    if (routeDeckId && deck.deckId === routeDeckId && deck.html) {
      void listDecks()
        .then((summaries) => {
          if (!cancelled) {
            store().setDecks(summaries)
            store().setSaveError('')
          }
        })
        .catch(() => {
          // Ignore list refresh failures on the already-loaded path.
        })

      return () => {
        cancelled = true
      }
    }

    const bootRequestId = ++saveRequestId
    const bootStillOwnsSession = () => !cancelled && saveRequestId === bootRequestId

    const loadDecks = async () => {
      store().setLoading(true)

      try {
        const summariesPromise = listDecks()

        if (!routeDeckId) {
          store().clearActiveDeck()
          newDeckPromise = null
          const summaries = await summariesPromise

          if (!bootStillOwnsSession()) {
            return
          }

          store().setDecks(summaries)
          store().setSaveError('')
          return
        }

        const earlyDeckPromise = fetchDeck(routeDeckId).catch(() => null)

        void earlyDeckPromise.then((loaded) => {
          if (!bootStillOwnsSession() || !loaded || loaded.id !== routeDeckId) {
            return
          }

          store().setActiveDeck(loaded)
          store().setLoading(false)
        })

        const summaries = await summariesPromise

        if (cancelled) {
          return
        }

        store().setDecks(summaries)
        store().setSaveError('')

        if (!bootStillOwnsSession()) {
          return
        }

        if (!summaries.some((entry) => entry.id === routeDeckId)) {
          store().clearActiveDeck()
          store().setSaveError('Could not load the deck.')
          return
        }

        const earlyDeck = await earlyDeckPromise

        if (!bootStillOwnsSession()) {
          return
        }

        if (earlyDeck && earlyDeck.id === routeDeckId) {
          store().setActiveDeck(earlyDeck)
          return
        }

        try {
          const loaded = await fetchDeck(routeDeckId)

          if (!bootStillOwnsSession()) {
            return
          }

          store().setActiveDeck(loaded)
        } catch {
          if (!bootStillOwnsSession()) {
            return
          }

          store().clearActiveDeck()
          store().setSaveError('Could not load the deck.')
        }
      } catch {
        if (!bootStillOwnsSession()) {
          return
        }

        store().clearActiveDeck()
        store().setDecks([])
        store().setSaveError('Could not load saved decks.')
      } finally {
        store().setLoading((current) =>
          cancelled || saveRequestId !== bootRequestId ? current : false,
        )
      }
    }

    void loadDecks()

    return () => {
      cancelled = true
    }
  }

  return {
    applyPatchedDeck,
    boot,
    deleteActiveDeck,
    duplicate,
    ensureBlankDeck,
    moveTo,
    openWorkspaceFile,
    patchDeckOperations,
    persistHtml,
    refreshActiveDeck,
    renameActiveDeck,
    restoreFromHistory,
    restoreHtmlSnapshot,
    saveAs,
    selectDeck,
    startNewDeck,
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
