import type { EditorSelectionInfo } from '@ark/editor-runtime'
import { isInlineTextEditableTag } from '@ark/deck/document/editable.ts'
import { isTextBoxEditableValue } from '@ark/deck/patch/text-box.ts'

export type DeckTextEditCommit = {
  elementId: string
  slideIndex: number
  slideId: string | null
  text: string
  originalText: string | null
}

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
