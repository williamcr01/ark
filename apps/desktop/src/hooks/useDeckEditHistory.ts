import { useCallback, useMemo, useState } from 'react'

import type { ManualEditProvenance } from '@ark/deck/document/edit-provenance.ts'

export type ExternalEditProvenance = {
  source: 'external'
  clientName: string | null
  toolName: string
  summary: string
  createdAt: string
}

export type AgentEditProvenance = {
  source: 'agent'
  summary: string
  createdAt: string
}

/**
 * A single reversible edit boundary (issue #299 session undo).
 *
 * Each entry stores the deck HTML before and after one committed step:
 * one editor gesture, one in-app agent turn, or one coalesced MCP turn.
 * Pointer-move previews are already coalesced into a single commit upstream.
 * Session-only: close/crash drops this stack; durable `.ark` history is backend.
 */
export type DeckEditHistoryEntry = {
  beforeHtml: string
  afterHtml: string
  slideIndex: number
  provenance: ManualEditProvenance | ExternalEditProvenance | AgentEditProvenance
}

export type HistoryState = {
  stack: DeckEditHistoryEntry[]
  pointer: number
}

export const EMPTY_HISTORY_STATE: HistoryState = { stack: [], pointer: -1 }

function isExternalProvenance(
  provenance: DeckEditHistoryEntry['provenance'],
): provenance is ExternalEditProvenance {
  return provenance.source === 'external'
}

/**
 * Consecutive MCP writes in one turn collapse to a single stack entry.
 * Manual gestures and in-app agent jobs stay one entry each.
 */
function canCoalesceExternalWrites(
  previous: DeckEditHistoryEntry,
  next: DeckEditHistoryEntry,
): boolean {
  return (
    isExternalProvenance(previous.provenance) &&
    isExternalProvenance(next.provenance) &&
    previous.afterHtml === next.beforeHtml
  )
}

/**
 * Pure stack reducer for session undo. Exported so coalescing rules can be
 * unit-tested without mounting the hook.
 */
export function recordDeckEdit(state: HistoryState, entry: DeckEditHistoryEntry): HistoryState {
  // Debounced identical HTML and no-op autosave ticks are not steps.
  if (entry.beforeHtml === entry.afterHtml) {
    return state
  }

  const retained = state.stack.slice(0, state.pointer + 1)
  const previous = retained.at(-1)
  if (previous && canCoalesceExternalWrites(previous, entry)) {
    const merged: DeckEditHistoryEntry = {
      ...previous,
      afterHtml: entry.afterHtml,
      slideIndex: entry.slideIndex,
      provenance: entry.provenance,
    }
    const stack = [...retained.slice(0, -1), merged]
    return { stack, pointer: stack.length - 1 }
  }

  const stack = [...retained, entry]
  return { stack, pointer: stack.length - 1 }
}

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
  /** Clear all history (e.g. deck switch). */
  reset: () => void
}

/**
 * Client-side undo/redo stack for the current editing session.
 *
 * Storage-agnostic: HTML snapshots and provenance only. Applying a snapshot is
 * the caller's job. Close or crash drops the stack; that persistence is the
 * backend half of issue #299 and is intentionally not implemented here.
 */
export function useDeckEditHistory(): DeckEditHistory {
  const [state, setState] = useState<HistoryState>(EMPTY_HISTORY_STATE)

  const record = useCallback((entry: DeckEditHistoryEntry) => {
    setState((current) => recordDeckEdit(current, entry))
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
    setState(EMPTY_HISTORY_STATE)
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
