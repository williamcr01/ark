import type { EditorSelectionContext } from '@ark/chat/chat.ts'
import type { EditorSelectionInfo } from '@ark/editor-runtime'

const MAX_TEXT_PREVIEW_LENGTH = 280

/**
 * Map the manual editor's live selection into the compact context forwarded with
 * generation requests (issue #83). Returns `undefined` when nothing is selected
 * so callers can omit the field entirely.
 */
export function toEditorSelectionContext(
  selection: EditorSelectionInfo | null,
): EditorSelectionContext | undefined {
  if (!selection) {
    return undefined
  }

  const textPreview = selection.textPreview?.trim().slice(0, MAX_TEXT_PREVIEW_LENGTH)

  return {
    slideIndex: selection.slideIndex,
    ...(selection.slideId ? { slideId: selection.slideId } : {}),
    elementId: selection.elementId,
    ...(selection.editableKind ? { elementKind: selection.editableKind } : {}),
    ...(textPreview ? { textPreview } : {}),
    locked: selection.locked,
    managed: selection.managed,
  }
}
