import { fetchDeck, listDecks } from '@/lib/api/deck-api'

import { store, type PersistenceSession } from './deck-persistence-session.ts'

export function createBoot(session: PersistenceSession) {
  return (routeDeckId: string | null) => {
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

    const bootRequestId = ++session.saveRequestId
    const bootStillOwnsSession = () => !cancelled && session.saveRequestId === bootRequestId
    void loadDecks(session, routeDeckId, bootRequestId, () => cancelled, bootStillOwnsSession)

    return () => {
      cancelled = true
    }
  }
}

async function loadDecks(
  session: PersistenceSession,
  routeDeckId: string | null,
  bootRequestId: number,
  isCancelled: () => boolean,
  bootStillOwnsSession: () => boolean,
) {
  store().setLoading(true)

  try {
    const summariesPromise = listDecks()

    if (!routeDeckId) {
      store().clearActiveDeck()
      session.newDeckPromise = null
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

    if (isCancelled()) {
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

    await loadRoutedDeck(routeDeckId, bootStillOwnsSession)
  } catch {
    if (!bootStillOwnsSession()) {
      return
    }

    store().clearActiveDeck()
    store().setDecks([])
    store().setSaveError('Could not load saved decks.')
  } finally {
    store().setLoading((current) =>
      isCancelled() || session.saveRequestId !== bootRequestId ? current : false,
    )
  }
}

async function loadRoutedDeck(routeDeckId: string, bootStillOwnsSession: () => boolean) {
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
}
