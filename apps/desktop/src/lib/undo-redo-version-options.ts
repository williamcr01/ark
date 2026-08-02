import type { DeckManualVersionProvenance } from '@ark/contracts'

import type { DeckEditHistoryEntry } from '@/hooks/useDeckEditHistory'

export type UndoRedoKind = 'undo' | 'redo'

/**
 * Build the version options sent with an undo/redo PUT snapshot restore.
 * Server honors client provenance only for `source: 'manual'`.
 */
export function buildUndoRedoVersionOptions(
  kind: UndoRedoKind,
  entry: DeckEditHistoryEntry,
): {
  summary: string
  provenance: DeckManualVersionProvenance
} {
  const provenance: DeckManualVersionProvenance = {
    operations: [kind],
    ...(entry.provenance.slideIndexes.length > 0
      ? { slideIndexes: entry.provenance.slideIndexes }
      : {}),
    ...(entry.provenance.elementIds.length > 0 ? { elementIds: entry.provenance.elementIds } : {}),
  }

  return {
    summary: `${kind === 'undo' ? 'Undo' : 'Redo'}: ${entry.provenance.summary}`,
    provenance,
  }
}
