import { toast } from 'sonner'

import { buildManualEditProvenance } from '@ark/deck/document/edit-provenance.ts'
import type { DeckPatchOperation } from '@ark/deck/patch/patch-request.ts'
import type { PatchDeckResponse } from '@/lib/api/deck-api'
import type { DeckEditHistoryEntry } from '@/state/editor-store.ts'

export type PatchedDeck =
  (PatchDeckResponse & { suggestedSlideIndex?: number; beforeHtml?: string }) | undefined

export type RunDeckPatchOptions = {
  requireDeck?: boolean
  missingDeckMessage?: string
  failureFallback?: string
  fixedFailure?: string
  historySlideIndex?: (result: PatchedDeck) => number
}

export function recordManualEdit(
  htmlRef: { current: string },
  recordEditHistory: (entry: DeckEditHistoryEntry) => void,
  beforeHtml: string,
  result: PatchedDeck,
  operations: DeckPatchOperation[],
  summary: string,
  slideIndex: number,
) {
  if (!result?.deck) {
    return
  }

  htmlRef.current = result.deck.html
  recordEditHistory({
    beforeHtml,
    afterHtml: result.deck.html,
    slideIndex,
    provenance: buildManualEditProvenance({
      operations,
      summary,
      slideIndexes: result.patch.changedSlideIndexes,
      elementIds: result.patch.changedElementIds,
    }),
  })
}

export async function runDeckPatch(
  deps: {
    deckId: string | null
    htmlRef: { current: string }
    patchDeckOperations: (
      operations: DeckPatchOperation[],
      slideIndex?: number,
    ) => Promise<PatchedDeck>
    recordEditHistory: (entry: DeckEditHistoryEntry) => void
    refreshActiveDeck: () => Promise<unknown>
  },
  operations: DeckPatchOperation[],
  summary: string,
  slideIndex: number,
  options: RunDeckPatchOptions = {},
) {
  if (options.requireDeck && !deps.deckId) {
    toast.error(options.missingDeckMessage ?? 'Save the deck before editing')
    throw new Error('Deck is not saved')
  }

  try {
    const result = await deps.patchDeckOperations(operations, slideIndex)
    recordManualEdit(
      deps.htmlRef,
      deps.recordEditHistory,
      result?.beforeHtml ?? deps.htmlRef.current,
      result,
      operations,
      summary,
      options.historySlideIndex?.(result) ?? slideIndex,
    )
    return result
  } catch (patchError) {
    toast.error(
      options.fixedFailure ??
        (patchError instanceof Error
          ? patchError.message
          : (options.failureFallback ?? 'Could not save the edit')),
    )
    try {
      await deps.refreshActiveDeck()
    } catch {
      // Ignore refresh failures after a failed patch.
    }
    throw patchError
  }
}
