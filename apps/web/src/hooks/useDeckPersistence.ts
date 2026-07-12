import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createDeck,
  deleteDeck,
  fetchDeck,
  fetchDeckVersion,
  listDeckVersions,
  listDecks,
  patchDeck,
  renameDeck,
  rollbackDeck,
  updateDeck,
  type DeckSummary,
  type DeckVersionDetail,
  type DeckVersionOptions,
  type DeckVersionSummary,
  type PatchDeckResponse,
  type StoredDeck,
} from '@/lib/deck-api'
import type { DeckPatchOperation } from '@ark/deck-core/deck-patch.ts'
import { extractDeckTitle } from '@ark/contracts'

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
  activeVersionId: deck.activeVersionId ?? null,
  versionNumber: deck.versionNumber ?? null,
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
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null)
  const [versionNumber, setVersionNumber] = useState<number | null>(null)
  const [versions, setVersions] = useState<DeckVersionSummary[]>([])
  const [previewVersion, setPreviewVersion] = useState<DeckVersionDetail | null>(null)
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isPatching, setIsPatching] = useState(false)
  const [saveError, setSaveError] = useState('')
  const saveRequestIdRef = useRef(0)
  const patchRequestIdRef = useRef(0)
  const inspectRequestIdRef = useRef(0)

  const setActiveDeck = useCallback((deck: StoredDeck) => {
    setDeckId(deck.id)
    setDeckTitle(deck.title)
    setHtml(deck.html)
    setSavedHtml(deck.html)
    setActiveVersionId(deck.activeVersionId ?? null)
    setVersionNumber(deck.versionNumber ?? null)
    setPreviewVersion(null)
    writeActiveDeckId(deck.id)
  }, [])

  const clearActiveDeck = useCallback(() => {
    clearActiveDeckId()
    setDeckId(null)
    setDeckTitle('')
    setHtml('')
    setSavedHtml('')
    setActiveVersionId(null)
    setVersionNumber(null)
    setVersions([])
    setPreviewVersion(null)
  }, [])

  const refreshVersions = useCallback(async (targetDeckId: string) => {
    setIsLoadingVersions(true)

    try {
      const nextVersions = await listDeckVersions(targetDeckId)
      setVersions(nextVersions)
      return nextVersions
    } catch {
      setVersions([])
      return []
    } finally {
      setIsLoadingVersions(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const storedActiveDeckId = readActiveDeckId()

    const loadDecks = async () => {
      try {
        // Start the active-deck fetch in parallel with the list so reload/warm
        // shell chrome is not gated on listDecks round-trip latency.
        const summariesPromise = listDecks()
        const earlyDeckPromise = storedActiveDeckId
          ? fetchDeck(storedActiveDeckId).catch(() => null)
          : Promise.resolve(null)

        const [summaries, earlyDeck] = await Promise.all([summariesPromise, earlyDeckPromise])

        if (cancelled) {
          return
        }

        setDecks(summaries)
        setSaveError('')

        if (!storedActiveDeckId) {
          return
        }

        if (!summaries.some((deck) => deck.id === storedActiveDeckId)) {
          clearActiveDeck()
          return
        }

        try {
          const deck =
            earlyDeck && earlyDeck.id === storedActiveDeckId
              ? earlyDeck
              : await fetchDeck(storedActiveDeckId)

          if (cancelled) {
            return
          }

          setActiveDeck(deck)
          void refreshVersions(deck.id)
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
  }, [clearActiveDeck, refreshVersions, setActiveDeck])

  const persistHtml = useCallback(
    async (nextHtml: string, options: DeckVersionOptions = {}) => {
      const requestId = ++saveRequestIdRef.current

      setHtml(nextHtml)
      // Unlock shell chrome before the save round-trip when the title is still
      // auto-derived from HTML (new decks or unsaved renames).
      const previousExtracted = extractDeckTitle(savedHtml || html)
      if (!deckId || !deckTitle || deckTitle === previousExtracted) {
        setDeckTitle(extractDeckTitle(nextHtml))
      }
      setIsSaving(true)
      setSaveError('')

      try {
        const deck = deckId
          ? await updateDeck(deckId, nextHtml, options)
          : await createDeck(nextHtml, options)

        if (requestId !== saveRequestIdRef.current) {
          return undefined
        }

        setDeckId(deck.id)
        setDeckTitle(deck.title)
        setActiveVersionId(deck.activeVersionId ?? null)
        setVersionNumber(deck.versionNumber ?? null)
        writeActiveDeckId(deck.id)
        setSavedHtml(deck.html)
        setPreviewVersion(null)
        setDecks((currentDecks) => upsertDeckSummary(currentDecks, deck))
        await refreshVersions(deck.id)
        return deck
      } catch (error) {
        if (requestId !== saveRequestIdRef.current) {
          return undefined
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
    [deckId, deckTitle, html, refreshVersions, savedHtml],
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
        await refreshVersions(deck.id)
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
    [deckId, refreshVersions, setActiveDeck],
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

  const inspectVersion = useCallback(
    async (versionId: string) => {
      if (!deckId) {
        return null
      }

      const requestId = ++inspectRequestIdRef.current
      const version = await fetchDeckVersion(deckId, versionId)

      if (requestId !== inspectRequestIdRef.current) {
        return null
      }

      setPreviewVersion(version)
      return version
    },
    [deckId],
  )

  const clearVersionPreview = useCallback(() => {
    inspectRequestIdRef.current += 1
    setPreviewVersion(null)
  }, [])

  const rollbackToVersion = useCallback(
    async (versionId: string) => {
      if (!deckId) {
        return
      }

      const requestId = ++saveRequestIdRef.current

      setIsSaving(true)
      setSaveError('')

      try {
        const deck = await rollbackDeck(deckId, versionId)

        if (requestId !== saveRequestIdRef.current) {
          return
        }

        setActiveDeck(deck)
        setDecks((currentDecks) => upsertDeckSummary(currentDecks, deck))
        await refreshVersions(deck.id)
      } catch (error) {
        if (requestId !== saveRequestIdRef.current) {
          return
        }

        const message = error instanceof Error ? error.message : 'Could not roll back the deck.'

        setSaveError(message)
        throw error
      } finally {
        if (requestId === saveRequestIdRef.current) {
          setIsSaving(false)
        }
      }
    },
    [deckId, refreshVersions, setActiveDeck],
  )

  const refreshActiveDeck = useCallback(
    async (targetDeckId?: string) => {
      const resolvedDeckId = targetDeckId ?? deckId

      if (!resolvedDeckId) {
        return null
      }

      const requestId = ++saveRequestIdRef.current

      try {
        const deck = await fetchDeck(resolvedDeckId)

        if (requestId !== saveRequestIdRef.current) {
          return null
        }

        setActiveDeck(deck)
        setDecks((currentDecks) => upsertDeckSummary(currentDecks, deck))
        await refreshVersions(deck.id)
        return deck
      } catch (error) {
        if (requestId !== saveRequestIdRef.current) {
          return null
        }

        const message = error instanceof Error ? error.message : 'Could not refresh the deck.'

        setSaveError(message)
        throw error
      }
    },
    [deckId, refreshVersions, setActiveDeck],
  )

  const applyPatchedDeck = useCallback(
    (patchResult: PatchDeckResponse) => {
      const { deck, patch } = patchResult

      setHtml(deck.html)
      setSavedHtml(deck.html)
      setActiveVersionId(deck.activeVersionId ?? null)
      setVersionNumber(deck.versionNumber ?? null)
      setPreviewVersion(null)
      setDecks((currentDecks) => upsertDeckSummary(currentDecks, deck))
      void refreshVersions(deck.id)

      return patch.suggestedActiveSlideIndex
    },
    [refreshVersions],
  )

  const restoreHtmlSnapshot = useCallback(
    async (nextHtml: string, options: DeckVersionOptions = {}) => {
      if (!deckId) {
        throw new Error('Save the deck before editing.')
      }

      const requestId = ++patchRequestIdRef.current

      setIsPatching(true)
      setSaveError('')

      try {
        // Keep source locked to manual so callers cannot override it and
        // accidentally drop client provenance (accepted only for manual).
        const deck = await updateDeck(deckId, nextHtml, { ...options, source: 'manual' })

        if (requestId !== patchRequestIdRef.current) {
          return undefined
        }

        setHtml(deck.html)
        setSavedHtml(deck.html)
        setActiveVersionId(deck.activeVersionId ?? null)
        setVersionNumber(deck.versionNumber ?? null)
        setPreviewVersion(null)
        setDecks((currentDecks) => upsertDeckSummary(currentDecks, deck))
        void refreshVersions(deck.id)
        return deck
      } catch (error) {
        if (requestId !== patchRequestIdRef.current) {
          return undefined
        }

        const message = error instanceof Error ? error.message : 'Could not update the deck.'

        setSaveError(message)
        throw error
      } finally {
        if (requestId === patchRequestIdRef.current) {
          setIsPatching(false)
        }
      }
    },
    [deckId, refreshVersions],
  )

  const patchDeckOperations = useCallback(
    async (
      operations: DeckPatchOperation[],
      activeSlideIndex?: number,
      options: DeckVersionOptions = {},
    ) => {
      if (!deckId) {
        throw new Error('Save the deck before editing.')
      }

      const requestId = ++patchRequestIdRef.current

      setIsPatching(true)
      setSaveError('')

      try {
        const patchResult = await patchDeck(deckId, {
          operations,
          activeSlideIndex,
          source: options.source ?? 'manual',
          summary: options.summary,
          modelProvider: options.modelProvider,
          modelName: options.modelName,
        })

        if (requestId !== patchRequestIdRef.current) {
          return undefined
        }

        const suggestedSlideIndex = applyPatchedDeck(patchResult)
        return { ...patchResult, suggestedSlideIndex }
      } catch (error) {
        if (requestId !== patchRequestIdRef.current) {
          return undefined
        }

        const message = error instanceof Error ? error.message : 'Could not patch the deck.'

        setSaveError(message)
        throw error
      } finally {
        if (requestId === patchRequestIdRef.current) {
          setIsPatching(false)
        }
      }
    },
    [applyPatchedDeck, deckId],
  )

  const hasDeck = html.length > 0
  const isDirty = hasDeck && html !== savedHtml

  return {
    activeVersionId,
    clearVersionPreview,
    deckId,
    deckTitle,
    decks,
    deleteActiveDeck,
    hasDeck,
    html,
    inspectVersion,
    isDirty,
    isLoading,
    isLoadingVersions,
    isPatching,
    isSaving,
    patchDeckOperations,
    persistHtml,
    previewVersion,
    refreshActiveDeck,
    refreshVersions,
    renameActiveDeck,
    restoreHtmlSnapshot,
    rollbackToVersion,
    saveError,
    selectDeck,
    startNewDeck,
    versionNumber,
    versions,
  }
}
