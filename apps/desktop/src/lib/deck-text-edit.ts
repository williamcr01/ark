import type { EditorSelectionInfo } from '@ark/deck-core/deck-editor-bridge.ts'
import { isInlineTextEditableTag } from '@ark/deck-core/deck-editable.ts'
import { isTextBoxEditableValue } from '@ark/deck-core/deck-text-box.ts'

/** Plain-text inline editing only; nested markup inside elements is flattened on save. */
export function isTextEditableSelection(selection: EditorSelectionInfo | null) {
  if (!selection || selection.locked) {
    return false
  }

  if (isInlineTextEditableTag(selection.tagName)) {
    return true
  }

  return isTextBoxEditableValue(selection.editableKind)
}
