import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { ExternalDeckUpdate } from '@ark/contracts'

import { useDeckEditHistory } from './useDeckEditHistory'
import { useWorkspaceRuntimeContext } from './workspace-runtime-context'

export function useExternalDeckUpdates() {
  const { persistence, generation, htmlRef, readHistorySlideIndex } = useWorkspaceRuntimeContext()
  const {
    deckId,
    documentRevision,
    isSaving: isDeckSaving,
    isPatching: isDeckPatching,
    refreshActiveDeck,
  } = persistence
  const { isGenerating } = generation
  const { record: recordEditHistory } = useDeckEditHistory()

  const activeDeckIdRef = useRef(deckId)
  const documentRevisionRef = useRef(documentRevision)
  const externalBusyRef = useRef(false)
  const pendingExternalUpdateRef = useRef<ExternalDeckUpdate | null>(null)
  const applyingExternalUpdateRef = useRef(false)
  const [externalUpdateTick, setExternalUpdateTick] = useState(0)

  useEffect(() => {
    documentRevisionRef.current = documentRevision
  }, [documentRevision])

  useEffect(() => {
    activeDeckIdRef.current = deckId
    pendingExternalUpdateRef.current = null
  }, [deckId])

  useEffect(() => {
    externalBusyRef.current = isDeckSaving || isDeckPatching || isGenerating
    if (!externalBusyRef.current) setExternalUpdateTick((value) => value + 1)
  }, [isDeckPatching, isDeckSaving, isGenerating])

  useEffect(
    () =>
      window.arkDesktop.mcp.onDeckUpdated((update) => {
        if (
          update.deckId !== activeDeckIdRef.current ||
          update.documentRevision <= (documentRevisionRef.current ?? 0)
        ) {
          return
        }
        const pending = pendingExternalUpdateRef.current
        if (!pending || update.documentRevision > pending.documentRevision) {
          pendingExternalUpdateRef.current = update
        }
        setExternalUpdateTick((value) => value + 1)
      }),
    [],
  )

  useEffect(() => {
    const update = pendingExternalUpdateRef.current
    if (!update || externalBusyRef.current || applyingExternalUpdateRef.current) return
    pendingExternalUpdateRef.current = null
    applyingExternalUpdateRef.current = true
    const beforeHtml = htmlRef.current

    void refreshActiveDeck(update.deckId)
      .then((deck) => {
        if (
          activeDeckIdRef.current !== update.deckId ||
          !deck ||
          deck.documentRevision < update.documentRevision ||
          deck.html === beforeHtml
        ) {
          return
        }
        documentRevisionRef.current = deck.documentRevision
        htmlRef.current = deck.html
        recordEditHistory({
          beforeHtml,
          afterHtml: deck.html,
          slideIndex: readHistorySlideIndex(),
          provenance: {
            source: 'external',
            clientName: update.clientName,
            toolName: update.toolName,
            summary: update.summary,
            createdAt: new Date().toISOString(),
          },
        })
        toast.success(`Updated by ${update.clientName ?? 'external agent'}`)
      })
      .catch((refreshError) => {
        toast.error(
          refreshError instanceof Error
            ? refreshError.message
            : 'Could not load the external deck update',
        )
      })
      .finally(() => {
        applyingExternalUpdateRef.current = false
        setExternalUpdateTick((value) => value + 1)
      })
  }, [externalUpdateTick, htmlRef, readHistorySlideIndex, recordEditHistory, refreshActiveDeck])
}
