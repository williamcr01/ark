import type { EditorSelectionInfo } from '@ark/editor-runtime'

/** Why a multi-element selection cannot be moved, nudged, or deleted as a set. */
export function getSelectionSetBlockReason(selections: EditorSelectionInfo[]): string | null {
  if (selections.length <= 1) {
    return selections[0]?.locked
      ? 'Move, nudge, and delete need the selected element to be unlocked.'
      : null
  }

  if (selections.some((item) => item.locked) || selections.some((item) => item.nestedInSelection)) {
    return 'Move, nudge, and delete need every selected element to be unlocked and not nested.'
  }

  return null
}
