import type { DeckPatchOperation } from './deck-patch.ts'

/**
 * Provenance metadata for a manual editor operation (issue #82).
 *
 * Manual edits are persisted as immutable deck versions with `source: 'manual'`
 * and a human-readable `summary`. This structure captures the richer,
 * operation-level provenance the client keeps alongside undo/redo history so it
 * can be surfaced in version history and future diff/provenance work (#36).
 */
export type ManualEditProvenance = {
  /** Always `manual` for editor-originated edits. */
  source: 'manual'
  /** Primary operation kind (first operation in the batch). */
  operation: DeckPatchOperation['op']
  /** All operation kinds applied in this edit, in order. */
  operations: DeckPatchOperation['op'][]
  /** Zero-based indexes of slides changed by the edit. */
  slideIndexes: number[]
  /** Ark element ids affected by the edit. */
  elementIds: string[]
  /** Concise, human-readable description of the edit. */
  summary: string
  /** ISO timestamp of when the edit was recorded on the client. */
  createdAt: string
}

const OPERATION_LABELS: Record<DeckPatchOperation['op'], string> = {
  add_slide: 'Added slide',
  delete_slide: 'Deleted slide',
  replace_slide: 'Replaced slide',
  reorder_slide: 'Reordered slide',
  update_slide_title: 'Updated slide title',
  update_slide_notes: 'Updated slide notes',
  replace_text: 'Edited text',
  insert_element: 'Inserted element',
  delete_element: 'Deleted element',
  duplicate_element: 'Duplicated element',
  set_attrs: 'Updated element attributes',
  set_inline_style: 'Updated element style',
  move_element: 'Moved element',
  resize_element: 'Resized element',
  reorder_element: 'Reordered element',
  lock_element: 'Locked element',
  unlock_element: 'Unlocked element',
  text_replace: 'Replaced text',
}

/**
 * Build a concise, human-readable summary from a batch of manual operations.
 *
 * Move + resize commits from a single drag are coalesced into one label so the
 * derived summary matches the single history item they produce.
 */
export function summarizeManualEditOperations(operations: DeckPatchOperation[]): string {
  if (operations.length === 0) {
    return 'Edited deck'
  }

  const kinds = operations.map((operation) => operation.op)
  const uniqueKinds = [...new Set(kinds)]

  if (
    uniqueKinds.length === 2 &&
    uniqueKinds.includes('move_element') &&
    uniqueKinds.includes('resize_element')
  ) {
    return 'Moved and resized element'
  }

  if (uniqueKinds.length === 1) {
    return OPERATION_LABELS[uniqueKinds[0]!]
  }

  return `Applied ${operations.length} edits`
}

function collectSlideIndexes(operations: DeckPatchOperation[]): number[] {
  const indexes = new Set<number>()

  for (const operation of operations) {
    if ('slideIndex' in operation && typeof operation.slideIndex === 'number') {
      indexes.add(operation.slideIndex)
    }
  }

  return [...indexes].sort((left, right) => left - right)
}

function collectElementIds(operations: DeckPatchOperation[]): string[] {
  const ids = new Set<string>()

  for (const operation of operations) {
    if ('elementId' in operation && operation.elementId) {
      ids.add(operation.elementId)
    }
  }

  return [...ids]
}

export type BuildManualEditProvenanceInput = {
  operations: DeckPatchOperation[]
  /** Optional contextual summary; falls back to a derived operation summary. */
  summary?: string
  /** Slide indexes reported by the server patch result (preferred when known). */
  slideIndexes?: number[]
  /** Element ids reported by the server patch result (preferred when known). */
  elementIds?: string[]
  /** Override the recorded timestamp (defaults to now). */
  createdAt?: string
}

/**
 * Assemble structured manual-edit provenance from the operations applied plus
 * any server-reported change metadata. When the server does not report changed
 * slides/elements, they are derived from the operations themselves.
 */
export function buildManualEditProvenance({
  operations,
  summary,
  slideIndexes,
  elementIds,
  createdAt,
}: BuildManualEditProvenanceInput): ManualEditProvenance {
  const resolvedSummary = summary?.trim() || summarizeManualEditOperations(operations)
  const resolvedSlideIndexes =
    slideIndexes && slideIndexes.length > 0 ? slideIndexes : collectSlideIndexes(operations)
  const resolvedElementIds =
    elementIds && elementIds.length > 0 ? elementIds : collectElementIds(operations)

  return {
    source: 'manual',
    operation: operations[0]?.op ?? 'replace_text',
    operations: operations.map((operation) => operation.op),
    slideIndexes: resolvedSlideIndexes,
    elementIds: resolvedElementIds,
    summary: resolvedSummary,
    createdAt: createdAt ?? new Date().toISOString(),
  }
}
