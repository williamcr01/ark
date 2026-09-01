import { useCallback, useEffect, useRef, useState } from 'react'

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
  type DeckSummary,
  type PatchDeckResponse,
  type StoredDeck,
} from '@/lib/api/deck-api'
import type { DeckPatchOperation } from '@ark/deck/patch/patch-request.ts'
import { ApiResponseError, extractDeckTitle } from '@ark/contracts'

/** A blank white slide: no starter content, so the first edit or generation owns the deck. */
const NEW_DECK_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Untitled Presentation</title><style>html,body{margin:0}body{font-family:system-ui,sans-serif}.slide{box-sizing:border-box;width:100vw;height:100vh;padding:8%;background:#fff;color:#171717}</style></head><body><section class="slide"></section></body></html>`

const toDeckSummary = (deck: StoredDeck): DeckSummary => ({
  id: deck.id,
  title: deck.title,
  createdAt: deck.createdAt,
  updatedAt: deck.updatedAt,
  documentRevision: deck.documentRevision,
  filePath: deck.filePath,
})

const sortDeckSummaries = (decks: DeckSummary[]) =>
  decks.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))

const upsertDeckSummary = (decks: DeckSummary[], deck: StoredDeck) =>
  sortDeckSummaries([
    toDeckSummary(deck),
    ...decks.filter((existingDeck) => existingDeck.id !== deck.id),
  ])

/**
 * @param routeDeckId Deck id from `/decks/:deckId`, or `null` on `/decks/new`.
 */
export function useDeckPersistence(routeDeckId: string | null = null) {
  const [decks, setDecks] = useState<DeckSummary[]>([])
  const [html, setHtml] = useState('')
  const [savedHtml, setSavedHtml] = useState('')
  const [deckId, setDeckId] = useState<string | null>(null)
  const [deckTitle, setDeckTitle] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [documentRevision, setDocumentRevision] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isPatching, setIsPatching] = useState(false)
  const [saveError, setSaveError] = useState('')
  const saveRequestIdRef = useRef(0)
  const patchRequestIdRef = useRef(0)
  const manualMutationQueueRef = useRef<Promise<void> | null>(null)
  const htmlRef = useRef('')
  const deckIdRef = useRef<string | null>(null)
  const documentRevisionRef = useRef<number | null>(null)
  const newDeckPromiseRef = useRef<ReturnType<typeof createDeck> | null>(null)

  const setActiveDeck = useCallback((deck: StoredDeck) => {
    htmlRef.current = deck.html
    deckIdRef.current = deck.id
    documentRevisionRef.current = deck.documentRevision
    setDeckId(deck.id)
    setDeckTitle(deck.title)
    setFilePath(deck.filePath)
    setHtml(deck.html)
    setSavedHtml(deck.html)
    setDocumentRevision(deck.documentRevision)
  }, [])

  const clearActiveDeck = useCallback(() => {
    htmlRef.current = ''
    deckIdRef.current = null
    documentRevisionRef.current = null
    setDeckId(null)
    setDeckTitle('')
    setFilePath(null)
    setHtml('')
    setSavedHtml('')
    setDocumentRevision(null)
  }, [])

  useEffect(() => {
    let cancelled = false

    // Create→navigate lands here with the deck already loaded. Refresh the list
    // only — do not bump saveRequestIdRef (would strand isSaving) or flash
    // isLoading for a list round-trip.
    if (routeDeckId && deckIdRef.current === routeDeckId && htmlRef.current) {
      void listDecks()
        .then((summaries) => {
          if (!cancelled) {
            setDecks(summaries)
            setSaveError('')
          }
        })
        .catch(() => {
          // Ignore list refresh failures on the already-loaded path.
        })

      return () => {
        cancelled = true
      }
    }

    // selectDeck / startNewDeck / persistHtml bump this ref; boot must not
    // overwrite a deck the user chose after early apply unlocked the shell.
    const bootRequestId = ++saveRequestIdRef.current
    const bootStillOwnsSession = () => !cancelled && saveRequestIdRef.current === bootRequestId

    const loadDecks = async () => {
      setIsLoading(true)

      try {
        const summariesPromise = listDecks()

        if (!routeDeckId) {
          clearActiveDeck()

          const deck = await (newDeckPromiseRef.current ??= createDeck(NEW_DECK_HTML, 'blank'))
          const summaries = await summariesPromise

          if (!bootStillOwnsSession()) {
            return
          }

          setActiveDeck(deck)
          setDecks(upsertDeckSummary(summaries, deck))
          setSaveError('')
          return
        }

        const earlyDeckPromise = fetchDeck(routeDeckId).catch(() => null)

        void earlyDeckPromise.then((deck) => {
          if (!bootStillOwnsSession() || !deck || deck.id !== routeDeckId) {
            return
          }

          setActiveDeck(deck)
          setIsLoading(false)
        })

        const summaries = await summariesPromise

        if (cancelled) {
          return
        }

        setDecks(summaries)
        setSaveError('')

        if (!bootStillOwnsSession()) {
          return
        }

        if (!summaries.some((deck) => deck.id === routeDeckId)) {
          clearActiveDeck()
          setSaveError('Could not load the deck.')
          return
        }

        const earlyDeck = await earlyDeckPromise

        if (!bootStillOwnsSession()) {
          return
        }

        if (earlyDeck && earlyDeck.id === routeDeckId) {
          setActiveDeck(earlyDeck)
          return
        }

        try {
          const deck = await fetchDeck(routeDeckId)

          if (!bootStillOwnsSession()) {
            return
          }

          setActiveDeck(deck)
        } catch {
          if (!bootStillOwnsSession()) {
            return
          }

          clearActiveDeck()
          setSaveError('Could not load the deck.')
        }
      } catch {
        if (!bootStillOwnsSession()) {
          return
        }

        clearActiveDeck()
        setDecks([])
        setSaveError('Could not load saved decks.')
      } finally {
        setIsLoading((current) =>
          cancelled || saveRequestIdRef.current !== bootRequestId ? current : false,
        )
      }
    }

    void loadDecks()

    return () => {
      cancelled = true
    }
  }, [clearActiveDeck, routeDeckId, setActiveDeck])

  const persistHtml = useCallback(
    async (nextHtml: string) => {
      const requestId = ++saveRequestIdRef.current

      htmlRef.current = nextHtml
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
          ? await updateDeck(deckId, nextHtml, documentRevisionRef.current!)
          : await createDeck(nextHtml)

        if (requestId !== saveRequestIdRef.current) {
          return undefined
        }

        deckIdRef.current = deck.id
        setDeckId(deck.id)
        setDeckTitle(deck.title)
        setFilePath(deck.filePath)
        setDocumentRevision(deck.documentRevision)
        documentRevisionRef.current = deck.documentRevision
        setSavedHtml(deck.html)
        setDecks((currentDecks) => upsertDeckSummary(currentDecks, deck))
        return deck
      } catch (error) {
        if (requestId !== saveRequestIdRef.current) {
          return undefined
        }

        const message = error instanceof Error ? error.message : 'Could not save the deck.'

        setSaveError(message)
        throw error
      } finally {
        setIsSaving((current) => (requestId === saveRequestIdRef.current ? false : current))
      }
    },
    [deckId, deckTitle, html, savedHtml],
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
        setIsLoading((current) => (requestId === saveRequestIdRef.current ? false : current))
      }
    },
    [deckId, setActiveDeck],
  )

  const startNewDeck = useCallback(async () => {
    saveRequestIdRef.current += 1
    setIsSaving(false)
    setSaveError('')
    clearActiveDeck()
    const promise = createDeck(NEW_DECK_HTML, 'blank')
    newDeckPromiseRef.current = promise
    const deck = await promise
    setActiveDeck(deck)
    setDecks((current) => upsertDeckSummary(current, deck))
    return deck
  }, [clearActiveDeck, setActiveDeck])

  const renameActiveDeck = useCallback(
    async (title: string) => {
      if (!deckId) {
        return
      }

      setIsSaving(true)
      setSaveError('')

      try {
        const deck = await renameDeck(deckId, title)

        // The rename syncs the document <title> server-side, so adopt the
        // returned HTML and its bumped revision to stay consistent.
        htmlRef.current = deck.html
        setDeckTitle(deck.title)
        setFilePath(deck.filePath)
        setHtml(deck.html)
        setSavedHtml(deck.html)
        setDocumentRevision(deck.documentRevision)
        documentRevisionRef.current = deck.documentRevision
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

  const applyWorkspaceAction = useCallback(
    async (action: () => Promise<StoredDeck>) => {
      setIsSaving(true)
      try {
        const deck = await action()
        setActiveDeck(deck)
        setDecks((current) => upsertDeckSummary(current, deck))
        return deck
      } finally {
        setIsSaving(false)
      }
    },
    [setActiveDeck],
  )

  const openWorkspaceFile = useCallback(
    (path: string) => applyWorkspaceAction(() => openWorkspace(path)),
    [applyWorkspaceAction],
  )
  const saveAs = useCallback(
    (path: string, overwrite = false) => {
      if (!deckId) throw new Error('No workspace is open.')
      return applyWorkspaceAction(() => saveWorkspaceAs(deckId, path, overwrite))
    },
    [applyWorkspaceAction, deckId],
  )
  const moveTo = useCallback(
    (path: string, overwrite = false) => {
      if (!deckId) throw new Error('No workspace is open.')
      return applyWorkspaceAction(() => moveWorkspace(deckId, path, overwrite))
    },
    [applyWorkspaceAction, deckId],
  )
  const duplicate = useCallback(
    (mode: 'presentation' | 'complete', path?: string, overwrite = false) => {
      if (!deckId) throw new Error('No workspace is open.')
      return duplicateWorkspace(deckId, mode, path, overwrite)
    },
    [deckId],
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

        if (requestId !== saveRequestIdRef.current || resolvedDeckId !== deckIdRef.current) {
          return null
        }

        setActiveDeck(deck)
        setDecks((currentDecks) => upsertDeckSummary(currentDecks, deck))
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
    [deckId, setActiveDeck],
  )

  const applyPatchedDeck = useCallback((patchResult: PatchDeckResponse) => {
    const { deck, patch } = patchResult

    htmlRef.current = deck.html
    setHtml(deck.html)
    setSavedHtml(deck.html)
    setDocumentRevision(deck.documentRevision)
    documentRevisionRef.current = deck.documentRevision
    setDecks((currentDecks) => upsertDeckSummary(currentDecks, deck))

    return patch.suggestedActiveSlideIndex
  }, [])

  const enqueueManualMutation = useCallback(<T>(mutation: () => Promise<T>) => {
    const previous = manualMutationQueueRef.current
    const result = previous ? previous.then(mutation, mutation) : mutation()
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    manualMutationQueueRef.current = settled
    void settled.then(() => {
      if (manualMutationQueueRef.current === settled) {
        manualMutationQueueRef.current = null
      }
    })
    return result
  }, [])

  const restoreHtmlSnapshot = useCallback(
    (nextHtml: string) => {
      const sessionId = saveRequestIdRef.current

      return enqueueManualMutation(async () => {
        if (!deckId) {
          throw new Error('Save the deck before editing.')
        }

        if (sessionId !== saveRequestIdRef.current) {
          return undefined
        }

        const requestId = ++patchRequestIdRef.current

        setIsPatching(true)
        setSaveError('')

        try {
          const deck = await updateDeck(deckId, nextHtml, documentRevisionRef.current!)

          if (sessionId !== saveRequestIdRef.current || requestId !== patchRequestIdRef.current) {
            return undefined
          }

          htmlRef.current = deck.html
          setHtml(deck.html)
          setSavedHtml(deck.html)
          setDocumentRevision(deck.documentRevision)
          documentRevisionRef.current = deck.documentRevision
          setDecks((currentDecks) => upsertDeckSummary(currentDecks, deck))
          return deck
        } catch (error) {
          if (sessionId !== saveRequestIdRef.current || requestId !== patchRequestIdRef.current) {
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
      })
    },
    [deckId, enqueueManualMutation],
  )

  const patchDeckOperations = useCallback(
    (operations: DeckPatchOperation[], activeSlideIndex?: number) => {
      const sessionId = saveRequestIdRef.current

      return enqueueManualMutation(async () => {
        if (!deckId) {
          throw new Error('Save the deck before editing.')
        }

        if (sessionId !== saveRequestIdRef.current) {
          return undefined
        }

        const requestId = ++patchRequestIdRef.current
        const beforeHtml = htmlRef.current

        setIsPatching(true)
        setSaveError('')

        try {
          const patchResult = await patchDeck(deckId, {
            operations,
            activeSlideIndex,
            expectedDocumentRevision: documentRevisionRef.current!,
          })

          if (sessionId !== saveRequestIdRef.current || requestId !== patchRequestIdRef.current) {
            return undefined
          }

          const suggestedSlideIndex = applyPatchedDeck(patchResult)
          return { ...patchResult, suggestedSlideIndex, beforeHtml }
        } catch (error) {
          if (sessionId !== saveRequestIdRef.current || requestId !== patchRequestIdRef.current) {
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
      })
    },
    [applyPatchedDeck, deckId, enqueueManualMutation],
  )

  const restoreFromHistory = useCallback(
    (historyRevision: number) => {
      if (!deckId) {
        throw new Error('Save the deck before restoring.')
      }

      const sessionId = saveRequestIdRef.current

      return enqueueManualMutation(async () => {
        if (sessionId !== saveRequestIdRef.current) {
          return undefined
        }

        const expectedDocumentRevision = documentRevisionRef.current
        if (!expectedDocumentRevision) {
          throw new Error('Save the deck before restoring.')
        }

        const requestId = ++patchRequestIdRef.current
        setIsPatching(true)
        setSaveError('')

        try {
          const deck = await restoreDocumentHistory(deckId, {
            revision: historyRevision,
            expectedDocumentRevision,
          })

          if (sessionId !== saveRequestIdRef.current || requestId !== patchRequestIdRef.current) {
            return undefined
          }

          setActiveDeck(deck)
          setDecks((currentDecks) => upsertDeckSummary(currentDecks, deck))
          return deck
        } catch (error) {
          if (sessionId !== saveRequestIdRef.current || requestId !== patchRequestIdRef.current) {
            return undefined
          }

          if (error instanceof ApiResponseError && error.code === 'document_conflict') {
            await refreshActiveDeck()
          }

          const message = error instanceof Error ? error.message : 'Could not restore that version.'
          setSaveError(message)
          throw error
        } finally {
          if (requestId === patchRequestIdRef.current) {
            setIsPatching(false)
          }
        }
      })
    },
    [deckId, enqueueManualMutation, refreshActiveDeck, setActiveDeck],
  )

  const hasDeck = html.length > 0
  const isDirty = hasDeck && html !== savedHtml

  return {
    documentRevision,
    duplicate,
    deckId,
    deckTitle,
    decks,
    deleteActiveDeck,
    hasDeck,
    html,
    filePath,
    isDirty,
    isLoading,
    isPatching,
    isSaving,
    patchDeckOperations,
    persistHtml,
    moveTo,
    openWorkspaceFile,
    refreshActiveDeck,
    renameActiveDeck,
    restoreFromHistory,
    restoreHtmlSnapshot,
    saveError,
    saveAs,
    selectDeck,
    startNewDeck,
  }
}
