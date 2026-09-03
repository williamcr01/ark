import type { EditorSelectionContext } from '@ark/chat/context.ts'
import { MAX_EDITOR_SELECTIONS, type EditorSelectionInfo } from '@ark/editor-runtime'

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

/**
 * Job / chat payload matching #302: one element populates both singular and
 * array; N>1 keeps `editorSelection` as the primary and `editorSelections` as
 * the same-slide set (cap 32). Does not edit `@ark/contracts`.
 */
export function toEditorSelectionJobFields(
  primary: EditorSelectionInfo | null,
  selections: EditorSelectionInfo[] = [],
): {
  editorSelection?: EditorSelectionContext
  editorSelections?: EditorSelectionContext[]
} {
  const raw = selections.length > 0 ? selections : primary ? [primary] : []
  const slideIndex = primary?.slideIndex ?? raw[0]?.slideIndex

  if (slideIndex === undefined) {
    return {}
  }

  const seen = new Set<string>()
  const sameSlide: EditorSelectionContext[] = []

  for (const item of raw) {
    if (item.slideIndex !== slideIndex || seen.has(item.elementId)) {
      continue
    }

    const mapped = toEditorSelectionContext(item)

    if (!mapped) {
      continue
    }

    seen.add(item.elementId)
    sameSlide.push(mapped)

    if (sameSlide.length >= MAX_EDITOR_SELECTIONS) {
      break
    }
  }

  if (sameSlide.length === 0) {
    return {}
  }

  const resolvedPrimary =
    primary && sameSlide.some((item) => item.elementId === primary.elementId)
      ? sameSlide.find((item) => item.elementId === primary.elementId)
      : sameSlide[sameSlide.length - 1]

  return {
    editorSelection: resolvedPrimary,
    editorSelections: sameSlide,
  }
}

/** Ensure a job request that only has singular still sends both fields (#302). */
export function withEditorSelectionJobFields(options: {
  editorSelection?: EditorSelectionContext
  editorSelections?: EditorSelectionContext[]
}): {
  editorSelection?: EditorSelectionContext
  editorSelections?: EditorSelectionContext[]
} {
  const primary = options.editorSelection
  const raw = options.editorSelections?.length ? options.editorSelections : primary ? [primary] : []

  if (raw.length === 0) {
    return {}
  }

  const slideIndex = primary?.slideIndex ?? raw[0]!.slideIndex
  const seen = new Set<string>()
  const sameSlide: EditorSelectionContext[] = []

  for (const item of raw) {
    if (item.slideIndex !== slideIndex || seen.has(item.elementId)) {
      continue
    }

    seen.add(item.elementId)
    sameSlide.push(item)

    if (sameSlide.length >= MAX_EDITOR_SELECTIONS) {
      break
    }
  }

  if (sameSlide.length === 0) {
    return {}
  }

  const resolvedPrimary =
    primary && sameSlide.some((item) => item.elementId === primary.elementId)
      ? sameSlide.find((item) => item.elementId === primary.elementId)
      : sameSlide[sameSlide.length - 1]

  return {
    editorSelection: resolvedPrimary,
    editorSelections: sameSlide,
  }
}
