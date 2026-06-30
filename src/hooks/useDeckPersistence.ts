import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createDeck,
  deleteDeck,
  fetchDeck,
  updateDeck,
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

export function useDeckPersistence() {
  const [html, setHtml] = useState('')
  const [savedHtml, setSavedHtml] = useState('')
  const [deckId, setDeckId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(() => Boolean(readActiveDeckId()))
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const saveRequestIdRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const activeDeckId = readActiveDeckId()

    if (!activeDeckId) {
      return () => {
        cancelled = true
      }
    }

    const loadDeck = async () => {
      try {
        const deck = await fetchDeck(activeDeckId!)

        if (cancelled) {
          return
        }

        setDeckId(deck.id)
        setHtml(deck.html)
        setSavedHtml(deck.html)
        setSaveError('')
      } catch {
        if (cancelled) {
          return
        }

        clearActiveDeckId()
        setDeckId(null)
        setHtml('')
        setSavedHtml('')
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadDeck()

    return () => {
      cancelled = true
    }
  }, [])

  const persistHtml = useCallback(async (nextHtml: string) => {
    const requestId = ++saveRequestIdRef.current

    setHtml(nextHtml)
    setIsSaving(true)
    setSaveError('')

    try {
      const deck = deckId
        ? await updateDeck(deckId, nextHtml)
        : await createDeck(nextHtml)

      if (requestId !== saveRequestIdRef.current) {
        return
      }

      setDeckId(deck.id)
      writeActiveDeckId(deck.id)
      setSavedHtml(nextHtml)
    } catch (error) {
      if (requestId !== saveRequestIdRef.current) {
        return
      }

      const message =
        error instanceof Error
          ? error.message
          : 'Could not save the deck.'

      setSaveError(message)
      throw error
    } finally {
      if (requestId === saveRequestIdRef.current) {
        setIsSaving(false)
      }
    }
  }, [deckId])

  const resetDeck = useCallback(async () => {
    saveRequestIdRef.current += 1
    setIsSaving(false)
    setSaveError('')

    if (deckId) {
      try {
        await deleteDeck(deckId)
      } catch {
        // Clearing local state is more important than a stale server file.
      }
    }

    clearActiveDeckId()
    setDeckId(null)
    setHtml('')
    setSavedHtml('')
  }, [deckId])

  const hasDeck = html.length > 0
  const isDirty = hasDeck && html !== savedHtml

  return {
    deckId,
    hasDeck,
    html,
    isDirty,
    isLoading,
    isSaving,
    persistHtml,
    resetDeck,
    saveError,
  }
}
