import { useMemo } from 'react'

import {
  EMPTY_HISTORY_STATE,
  EXTERNAL_COALESCE_IDLE_MS,
  recordDeckEdit,
  useEditorStore,
  type AgentEditProvenance,
  type DeckEditHistoryEntry,
  type ExternalEditProvenance,
  type HistoryState,
} from '@/state/editor-store.ts'

export {
  EMPTY_HISTORY_STATE,
  EXTERNAL_COALESCE_IDLE_MS,
  recordDeckEdit,
  type AgentEditProvenance,
  type DeckEditHistoryEntry,
  type ExternalEditProvenance,
  type HistoryState,
}

export type DeckEditHistory = {
  canUndo: boolean
  canRedo: boolean
  undoEntry: DeckEditHistoryEntry | null
  redoEntry: DeckEditHistoryEntry | null
  record: (entry: DeckEditHistoryEntry) => void
  commitUndo: () => void
  commitRedo: () => void
  reset: () => void
}

export function useDeckEditHistory(): DeckEditHistory {
  const history = useEditorStore((state) => state.history)
  const record = useEditorStore((state) => state.recordEdit)
  const commitUndo = useEditorStore((state) => state.commitUndo)
  const commitRedo = useEditorStore((state) => state.commitRedo)
  const reset = useEditorStore((state) => state.resetHistory)

  return useMemo(() => {
    const canUndo = history.pointer >= 0
    const canRedo = history.pointer < history.stack.length - 1

    return {
      canUndo,
      canRedo,
      undoEntry: canUndo ? (history.stack[history.pointer] ?? null) : null,
      redoEntry: canRedo ? (history.stack[history.pointer + 1] ?? null) : null,
      record,
      commitUndo,
      commitRedo,
      reset,
    }
  }, [commitRedo, commitUndo, history, record, reset])
}
