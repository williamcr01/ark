import type { EditorSelectionInfo } from '../../shared/deck-editor-bridge.ts'
import { isInlineTextEditableTag } from '../../shared/deck-editable.ts'

export function isTextEditableSelection(selection: EditorSelectionInfo | null) {
  if (!selection || selection.locked) {
    return false
  }

  return isInlineTextEditableTag(selection.tagName)
}
