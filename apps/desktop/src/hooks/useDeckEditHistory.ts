import { useCallback, useMemo, useState } from 'react'

import type { ManualEditProvenance } from '@ark/deck-core/deck-edit-provenance.ts'

/**
 * A single reversible manual edit boundary (issue #82).
 *
 * Each entry stores the deck HTML before and after one committed manual
 * operation (drag/resize previews are already coalesced into a single commit
 * upstream), plus the slide the change happened on and structured provenance.
 */
export type DeckEditHistoryEntry = {
  beforeHtml: string
  afterHtml: string
  slideIndex: number
  provenance: ManualEditProvenance
}

type HistoryState = {
  stack: DeckEditHistoryEntry[]
  pointer: number
}

const EMPTY_STATE: HistoryState = { stack: [], pointer: -1 }

export type DeckEditHistory = {
  canUndo: boolean
  canRedo: boolean
  /** Entry that an undo would revert (the most recently applied edit). */
  undoEntry: DeckEditHistoryEntry | null
  /** Entry that a redo would re-apply. */
  redoEntry: DeckEditHistoryEntry | null
  /** Record a newly committed edit, discarding any redo entries. */
  record: (entry: DeckEditHistoryEntry) => void
  /** Move the pointer back after an undo snapshot has been applied. */
  commitUndo: () => void
  /** Move the pointer forward after a redo snapshot has been applied. */
  commitRedo: () => void
  /** Clear all history (e.g. deck switch or AI generation boundary). */
  reset: () => void
}

/**
 * Client-side undo/redo stack for manual editor operations.
 *
 * The hook is intentionally storage-agnostic: it only tracks HTML snapshots and
 * provenance. Applying a snapshot to the server is the caller's responsibility,
 * which keeps history scoped to the current in-memory editing session.
 */
export function useDeckEditHistory(): DeckEditHistory {
  const [state, setState] = useState<HistoryState>(EMPTY_STATE)

  const record = useCallback((entry: DeckEditHistoryEntry) => {
    setState((current) => {
      const retained = current.stack.slice(0, current.pointer + 1)
      const stack = [...retained, entry]
      return { stack, pointer: stack.length - 1 }
    })
  }, [])

  const commitUndo = useCallback(() => {
    setState((current) =>
      current.pointer >= 0 ? { ...current, pointer: current.pointer - 1 } : current,
    )
  }, [])

  const commitRedo = useCallback(() => {
    setState((current) =>
      current.pointer < current.stack.length - 1
        ? { ...current, pointer: current.pointer + 1 }
        : current,
    )
  }, [])

  const reset = useCallback(() => {
    setState(EMPTY_STATE)
  }, [])

  return useMemo(() => {
    const canUndo = state.pointer >= 0
    const canRedo = state.pointer < state.stack.length - 1

    return {
      canUndo,
      canRedo,
      undoEntry: canUndo ? state.stack[state.pointer]! : null,
      redoEntry: canRedo ? state.stack[state.pointer + 1]! : null,
      record,
      commitUndo,
      commitRedo,
      reset,
    }
  }, [commitRedo, commitUndo, record, reset, state])
}
