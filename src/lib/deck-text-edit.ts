import type { EditorSelectionInfo } from '../../shared/deck-editor-bridge.ts'
import { isInlineTextEditableTag } from '../../shared/deck-editable.ts'
import { isTextBoxEditableValue } from '../../shared/deck-text-box.ts'

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
