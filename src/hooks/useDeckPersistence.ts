import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createDeck,
  deleteDeck,
  fetchDeck,
  listDecks,
  renameDeck,
  updateDeck,
  type DeckSummary,
  type StoredDeck,
} from '@/lib/deck-api'

const ACTIVE_DECK_STORAGE_KEY = 'ark:active-deck-id'

const readActiveDeckId = () => {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }

    return localStorage.getItem(ACTIVE_DECK_STORAGE_KEY)
  } catch {
    return null
  }
}

const writeActiveDeckId = (deckId: string) => {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }

    localStorage.setItem(ACTIVE_DECK_STORAGE_KEY, deckId)
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}

const clearActiveDeckId = () => {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }

    localStorage.removeItem(ACTIVE_DECK_STORAGE_KEY)
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}

const toDeckSummary = (deck: StoredDeck): DeckSummary => ({
  id: deck.id,
  title: deck.title,
  createdAt: deck.createdAt,
  updatedAt: deck.updatedAt,
})

const sortDeckSummaries = (decks: DeckSummary[]) =>
  [...decks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

const upsertDeckSummary = (decks: DeckSummary[], deck: StoredDeck) =>
  sortDeckSummaries([
    toDeckSummary(deck),
    ...decks.filter((existingDeck) => existingDeck.id !== deck.id),
  ])

export function useDeckPersistence() {
  const [decks, setDecks] = useState<DeckSummary[]>([])
  const [html, setHtml] = useState('')
  const [savedHtml, setSavedHtml] = useState('')
  const [deckId, setDeckId] = useState<string | null>(null)
  const [deckTitle, setDeckTitle] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const saveRequestIdRef = useRef(0)

  const setActiveDeck = useCallback((deck: StoredDeck) => {
    setDeckId(deck.id)
    setDeckTitle(deck.title)
    setHtml(deck.html)
    setSavedHtml(deck.html)
    writeActiveDeckId(deck.id)
  }, [])

  const clearActiveDeck = useCallback(() => {
    clearActiveDeckId()
    setDeckId(null)
    setDeckTitle('')
    setHtml('')
    setSavedHtml('')
  }, [])

  useEffect(() => {
    let cancelled = false
    const activeDeckId = readActiveDeckId()

    const loadDecks = async () => {
      try {
        const summaries = await listDecks()

        if (cancelled) {
          return
        }

        setDecks(summaries)
        setSaveError('')

        if (!activeDeckId) {
          return
        }

        if (!summaries.some((deck) => deck.id === activeDeckId)) {
          clearActiveDeck()
          return
        }

        try {
          const deck = await fetchDeck(activeDeckId)

          if (cancelled) {
            return
          }

          setActiveDeck(deck)
        } catch {
          if (cancelled) {
            return
          }

          clearActiveDeck()
        }
      } catch {
        if (cancelled) {
          return
        }

        clearActiveDeck()
        setDecks([])
        setSaveError('Could not load saved decks.')
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadDecks()

    return () => {
      cancelled = true
    }
  }, [clearActiveDeck, setActiveDeck])

  const persistHtml = useCallback(
    async (nextHtml: string) => {
      const requestId = ++saveRequestIdRef.current

      setHtml(nextHtml)
      setIsSaving(true)
      setSaveError('')

      try {
        const deck = deckId ? await updateDeck(deckId, nextHtml) : await createDeck(nextHtml)

        if (requestId !== saveRequestIdRef.current) {
          return
        }

        setDeckId(deck.id)
        setDeckTitle(deck.title)
        writeActiveDeckId(deck.id)
        setSavedHtml(deck.html)
        setDecks((currentDecks) => upsertDeckSummary(currentDecks, deck))
      } catch (error) {
        if (requestId !== saveRequestIdRef.current) {
          return
        }

        const message = error instanceof Error ? error.message : 'Could not save the deck.'

        setSaveError(message)
        throw error
      } finally {
        if (requestId === saveRequestIdRef.current) {
          setIsSaving(false)
        }
      }
    },
    [deckId],
  )

  const selectDeck = useCallback(
    async (nextDeckId: string) => {
      if (nextDeckId === deckId) {
        return
      }

      const requestId = ++saveRequestIdRef.current

      setIsLoading(true)
      setSaveError('')

      try {
        const deck = await fetchDeck(nextDeckId)

        if (requestId !== saveRequestIdRef.current) {
          return
        }

        setActiveDeck(deck)
        setDecks((currentDecks) => upsertDeckSummary(currentDecks, deck))
      } catch (error) {
        if (requestId !== saveRequestIdRef.current) {
          return
        }

        const message = error instanceof Error ? error.message : 'Could not load the deck.'

        setSaveError(message)
        throw error
      } finally {
        if (requestId === saveRequestIdRef.current) {
          setIsLoading(false)
        }
      }
    },
    [deckId, setActiveDeck],
  )

  const startNewDeck = useCallback(() => {
    saveRequestIdRef.current += 1
    setIsSaving(false)
    setSaveError('')
    clearActiveDeck()
  }, [clearActiveDeck])

  const renameActiveDeck = useCallback(
    async (title: string) => {
      if (!deckId) {
        return
      }

      setIsSaving(true)
      setSaveError('')

      try {
        const deck = await renameDeck(deckId, title)

        setDeckTitle(deck.title)
        setDecks((currentDecks) => upsertDeckSummary(currentDecks, deck))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not rename the deck.'

        setSaveError(message)
        throw error
      } finally {
        setIsSaving(false)
      }
    },
    [deckId],
  )

  const deleteActiveDeck = useCallback(async () => {
    if (!deckId) {
      clearActiveDeck()
      return
    }

    const deletedDeckId = deckId

    saveRequestIdRef.current += 1
    setIsSaving(true)
    setSaveError('')

    try {
      await deleteDeck(deletedDeckId)
      setDecks((currentDecks) => currentDecks.filter((deck) => deck.id !== deletedDeckId))
      clearActiveDeck()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not delete the deck.'

      setSaveError(message)
      throw error
    } finally {
      setIsSaving(false)
    }
  }, [clearActiveDeck, deckId])

  const hasDeck = html.length > 0
  const isDirty = hasDeck && html !== savedHtml

  return {
    deckId,
    deckTitle,
    decks,
    deleteActiveDeck,
    hasDeck,
    html,
    isDirty,
    isLoading,
    isSaving,
    persistHtml,
    renameActiveDeck,
    saveError,
    selectDeck,
    startNewDeck,
  }
}
