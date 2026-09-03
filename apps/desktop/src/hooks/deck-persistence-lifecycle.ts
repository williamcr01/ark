import {
  createDeck,
  fetchDeck,
  moveWorkspace,
  openWorkspace,
  saveWorkspaceAs,
  duplicateWorkspace,
  updateDeck,
  type StoredDeck,
} from '@/lib/api/deck-api'
import { extractDeckTitle } from '@ark/contracts'

import { store, type PersistenceSession } from './deck-persistence-session.ts'

/** A blank white slide: no starter content, so the first edit or generation owns the deck. */
export const NEW_DECK_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Untitled Presentation</title><style>html,body{margin:0}body{font-family:system-ui,sans-serif}.slide{box-sizing:border-box;width:100vw;height:100vh;padding:8%;background:#fff;color:#171717}</style></head><body><section class="slide"></section></body></html>`

export function createLifecycleActions(session: PersistenceSession) {
  const persistHtml = async (nextHtml: string) => {
    const requestId = ++session.saveRequestId
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

      if (requestId !== session.saveRequestId) {
        return undefined
      }

      store().applySavedDeck(deck)
      return deck
    } catch (error) {
      if (requestId !== session.saveRequestId) {
        return undefined
      }

      const message = error instanceof Error ? error.message : 'Could not save the deck.'

      store().setSaveError(message)
      throw error
    } finally {
      store().setSaving((current) => (requestId === session.saveRequestId ? false : current))
    }
  }

  const selectDeck = async (nextDeckId: string) => {
    if (nextDeckId === store().deckId) {
      return
    }

    const requestId = ++session.saveRequestId

    store().setLoading(true)
    store().setSaveError('')

    try {
      const deck = await fetchDeck(nextDeckId)

      if (requestId !== session.saveRequestId) {
        return
      }

      store().setActiveDeck(deck)
    } catch (error) {
      if (requestId !== session.saveRequestId) {
        return
      }

      const message = error instanceof Error ? error.message : 'Could not load the deck.'

      store().setSaveError(message)
      throw error
    } finally {
      store().setLoading((current) => (requestId === session.saveRequestId ? false : current))
    }
  }

  const startNewDeck = async () => {
    session.saveRequestId += 1
    store().setSaving(false)
    store().setSaveError('')
    session.newDeckPromise = null
    store().clearActiveDeck()
  }

  const ensureBlankDeck = async () => {
    if (store().deckId) {
      return store().deckId
    }

    const requestId = session.saveRequestId
    const promise = (session.newDeckPromise ??= createDeck(NEW_DECK_HTML, 'blank'))
    const deck = await promise

    if (session.saveRequestId !== requestId) {
      return store().deckId
    }

    store().setActiveDeck(deck)
    return deck.id
  }

  return {
    persistHtml,
    selectDeck,
    startNewDeck,
    ensureBlankDeck,
    ...createWorkspaceFileActions(),
    refreshActiveDeck: createRefreshActiveDeck(session),
  }
}

function createWorkspaceFileActions() {
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

  return { openWorkspaceFile, saveAs, moveTo, duplicate }
}

function createRefreshActiveDeck(session: PersistenceSession) {
  return async (targetDeckId?: string) => {
    const resolvedDeckId = targetDeckId ?? store().deckId

    if (!resolvedDeckId) {
      return null
    }

    const requestId = ++session.saveRequestId

    try {
      const deck = await fetchDeck(resolvedDeckId)

      if (requestId !== session.saveRequestId || resolvedDeckId !== store().deckId) {
        return null
      }

      store().setActiveDeck(deck)
      return deck
    } catch (error) {
      if (requestId !== session.saveRequestId) {
        return null
      }

      const message = error instanceof Error ? error.message : 'Could not refresh the deck.'

      store().setSaveError(message)
      throw error
    }
  }
}
