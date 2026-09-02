import { useCallback, useRef } from 'react'

import type {
  DeckElementPatchOperation,
  DeckPatchOperation,
} from '@ark/deck/patch/patch-request.ts'
import { runDeckPatch, type RunDeckPatchOptions } from '@/lib/editor/run-deck-patch'
import { restoreDocumentRevision, restoreEditSnapshot } from '@/lib/editor/restore-edit-snapshot'

import { useDeckEditHistory } from './useDeckEditHistory'
import { useWorkspaceRuntimeContext } from './workspace-runtime-context'

function usePatchRunner() {
  const { persistence, htmlRef } = useWorkspaceRuntimeContext()
  const { deckId, patchDeckOperations, refreshActiveDeck } = persistence
  const { record: recordEditHistory } = useDeckEditHistory()

  const runPatch = useCallback(
    (
      operations: DeckPatchOperation[],
      summary: string,
      slideIndex: number,
      options: RunDeckPatchOptions = {},
    ) =>
      runDeckPatch(
        { deckId, htmlRef, patchDeckOperations, recordEditHistory, refreshActiveDeck },
        operations,
        summary,
        slideIndex,
        options,
      ),
    [deckId, htmlRef, patchDeckOperations, recordEditHistory, refreshActiveDeck],
  )

  return { persistence, runPatch }
}

export function useManualEditCommits() {
  const { persistence, runPatch } = usePatchRunner()
  const { refreshActiveDeck, restoreFromHistory, restoreHtmlSnapshot } = persistence
  const {
    canRedo,
    canUndo,
    commitRedo,
    commitUndo,
    redoEntry,
    reset: resetEditHistory,
    undoEntry,
  } = useDeckEditHistory()
  const undoRedoInFlightRef = useRef(false)

  const handleCommitTextEdit = useCallback(
    async (commit: {
      elementId: string
      slideIndex: number
      slideId: string | null
      text: string
    }) => {
      const operations: DeckElementPatchOperation[] = [
        {
          op: 'replace_text',
          elementId: commit.elementId,
          slideIndex: commit.slideIndex,
          ...(commit.slideId ? { slideId: commit.slideId } : {}),
          text: commit.text,
        },
      ]
      return runPatch(operations, 'Edited text in preview', commit.slideIndex, {
        requireDeck: true,
        missingDeckMessage: 'Save the deck before editing text',
        failureFallback: 'Could not save the text edit',
      })
    },
    [runPatch],
  )

  const handlePatchEditorOperations = useCallback(
    async (operations: DeckElementPatchOperation[], activeSlideIndex: number, summary: string) =>
      runPatch(operations, summary, activeSlideIndex, {
        requireDeck: true,
        missingDeckMessage: 'Save the deck before editing',
        failureFallback: 'Could not save the edit',
      }),
    [runPatch],
  )

  const handleReorderSlide = useCallback(
    async (fromIndex: number, toIndex: number, activeSlideIndex: number) => {
      if (fromIndex === toIndex) {
        return undefined
      }

      return runPatch(
        [{ op: 'reorder_slide', slideIndex: fromIndex, toIndex }],
        `Moved slide ${fromIndex + 1} to position ${toIndex + 1}`,
        activeSlideIndex,
        {
          failureFallback: 'Could not reorder slide',
          fixedFailure: 'Could not reorder slide',
          historySlideIndex: (result) => result?.suggestedSlideIndex ?? activeSlideIndex,
        },
      )
    },
    [runPatch],
  )

  const handleUndoEdit = useCallback(
    () =>
      restoreEditSnapshot({
        inFlightRef: undoRedoInFlightRef,
        html: undoEntry?.beforeHtml,
        restoreHtmlSnapshot,
        commit: commitUndo,
        refreshActiveDeck,
        failureFallback: 'Could not undo the last edit',
      }),
    [commitUndo, refreshActiveDeck, restoreHtmlSnapshot, undoEntry],
  )

  const handleRedoEdit = useCallback(
    () =>
      restoreEditSnapshot({
        inFlightRef: undoRedoInFlightRef,
        html: redoEntry?.afterHtml,
        restoreHtmlSnapshot,
        commit: commitRedo,
        refreshActiveDeck,
        failureFallback: 'Could not redo the edit',
      }),
    [commitRedo, redoEntry, refreshActiveDeck, restoreHtmlSnapshot],
  )

  const handleRestoreDocumentHistory = useCallback(
    (revision: number) =>
      restoreDocumentRevision({
        revision,
        restoreFromHistory,
        resetEditHistory,
      }),
    [resetEditHistory, restoreFromHistory],
  )

  return {
    handleCommitTextEdit,
    handlePatchEditorOperations,
    handleReorderSlide,
    handleUndoEdit,
    handleRedoEdit,
    handleRestoreDocumentHistory,
    canUndo,
    canRedo,
    undoSlideIndex: undoEntry?.slideIndex ?? null,
    redoSlideIndex: redoEntry?.slideIndex ?? null,
  }
}
