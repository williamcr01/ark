import {
  isEditorDeleteRequestMessage,
  isEditorErrorMessage,
  isEditorGeometryMessage,
  isEditorHoverMessage,
  isEditorInsertRequestMessage,
  isEditorReadyMessage,
  isEditorSelectionChangeMessage,
  isEditorShortcutMessage,
  isEditorTextCommitMessage,
  isEditorTextEditStateMessage,
  isEditorTransformCancelMessage,
  isEditorTransformCommitMessage,
  isEditorTransformPreviewMessage,
  resolveEditorSelectionSet,
  type EditorGeometryMessage,
  type EditorRuntimeMessage,
  type EditorSelectionChangeMessage,
  type EditorTransformCommitMessage,
  type EditorTransformPreviewMessage,
} from '@ark/editor-runtime'

import { type DeckEditorBridgeState, type SelectionIdentity } from './editor-bridge-state.ts'

export type EditorRuntimeReduceResult = {
  state: DeckEditorBridgeState
  selectionIdentity: SelectionIdentity
  publishPreview?: EditorTransformPreviewMessage | null
  selectionChange?: {
    selection: DeckEditorBridgeState['selection']
    selections: DeckEditorBridgeState['selections']
  }
  editorError?: { message: string; code?: string }
}

function applySelectionChange(
  current: DeckEditorBridgeState,
  data: EditorSelectionChangeMessage,
  selectionIdentity: SelectionIdentity,
): EditorRuntimeReduceResult {
  const nextSelections = resolveEditorSelectionSet(data.selection, data.selections)
  const sameSelection =
    data.selection !== null &&
    selectionIdentity?.elementId === data.selection.elementId &&
    selectionIdentity.slideIndex === data.selection.slideIndex

  const keepIds = new Set(nextSelections.map((item) => item.elementId))
  const selectionGeometries = Object.fromEntries(
    Object.entries(current.selectionGeometries).filter(([elementId]) => keepIds.has(elementId)),
  )

  return {
    selectionIdentity: data.selection
      ? { elementId: data.selection.elementId, slideIndex: data.selection.slideIndex }
      : null,
    selectionChange: { selection: data.selection, selections: nextSelections },
    publishPreview: sameSelection ? undefined : null,
    state: {
      ...current,
      selection: data.selection,
      selections: nextSelections,
      geometry: sameSelection ? current.geometry : null,
      slideBounds: sameSelection ? current.slideBounds : null,
      selectionGeometries: sameSelection ? selectionGeometries : {},
      selectionZIndex: sameSelection ? current.selectionZIndex : null,
      transformPreview: sameSelection ? current.transformPreview : null,
    },
  }
}

function applyGeometryMessage(
  current: DeckEditorBridgeState,
  data: EditorGeometryMessage,
): DeckEditorBridgeState {
  const inSet = current.selections.some((item) => item.elementId === data.elementId)
  const nextGeometries = inSet
    ? {
        ...current.selectionGeometries,
        [data.elementId]: {
          geometry: data.geometry,
          slideBounds: data.slideBounds ?? null,
        },
      }
    : current.selectionGeometries

  if (current.selection?.elementId === data.elementId) {
    const selection =
      data.surface && data.surface !== current.selection.surface
        ? { ...current.selection, surface: data.surface }
        : current.selection

    return {
      ...current,
      selection,
      geometry: data.geometry,
      slideBounds: data.slideBounds ?? null,
      selectionZIndex: data.zIndex,
      selectionGeometries: nextGeometries,
    }
  }

  if (inSet) {
    return {
      ...current,
      selectionGeometries: nextGeometries,
    }
  }

  return current
}

function applyTransformCommit(
  current: DeckEditorBridgeState,
  data: EditorTransformCommitMessage,
  selectionIdentity: SelectionIdentity,
): EditorRuntimeReduceResult | null {
  if (
    selectionIdentity?.elementId !== data.elementId ||
    selectionIdentity.slideIndex !== data.slideIndex
  ) {
    return null
  }

  if (
    current.selection?.elementId !== data.elementId ||
    current.selection.slideIndex !== data.slideIndex
  ) {
    return {
      selectionIdentity,
      publishPreview: null,
      state: current,
    }
  }

  return {
    selectionIdentity,
    publishPreview: null,
    state: {
      ...current,
      transformCommit: data,
      transformPreview: null,
      geometry: data.geometry,
      slideBounds: data.slideBounds ?? current.slideBounds,
      selectionZIndex:
        data.zIndex !== undefined && data.zIndex !== null ? data.zIndex : current.selectionZIndex,
    },
  }
}

export function reduceEditorRuntimeMessage(
  current: DeckEditorBridgeState,
  data: EditorRuntimeMessage,
  selectionIdentity: SelectionIdentity,
): EditorRuntimeReduceResult | null {
  if (isEditorReadyMessage(data)) {
    return {
      selectionIdentity,
      state: { ...current, editorReady: true, editorError: null },
    }
  }

  if (isEditorHoverMessage(data)) {
    return {
      selectionIdentity,
      state: {
        ...current,
        hover: {
          elementId: data.elementId,
          slideIndex: data.slideIndex,
          ...(data.surface ? { surface: data.surface } : {}),
        },
        hoverGeometry: data.geometry ?? null,
        hoverSlideBounds: data.slideBounds ?? null,
      },
    }
  }

  if (isEditorSelectionChangeMessage(data)) {
    return applySelectionChange(current, data, selectionIdentity)
  }

  if (isEditorGeometryMessage(data)) {
    return { selectionIdentity, state: applyGeometryMessage(current, data) }
  }

  if (isEditorTextCommitMessage(data)) {
    return {
      selectionIdentity,
      state: {
        ...current,
        textEditActive: false,
        lastTextCommit: {
          elementId: data.elementId,
          slideIndex: data.slideIndex,
          slideId: data.slideId,
          text: data.text,
          originalText: data.originalText,
        },
      },
    }
  }

  if (isEditorTextEditStateMessage(data)) {
    return { selectionIdentity, state: { ...current, textEditActive: data.active } }
  }

  if (isEditorTransformPreviewMessage(data)) {
    if (current.transformPreview) {
      return { selectionIdentity, publishPreview: data, state: current }
    }

    return {
      selectionIdentity,
      publishPreview: data,
      state: { ...current, transformPreview: data, transformCommit: null },
    }
  }

  if (isEditorTransformCommitMessage(data)) {
    return applyTransformCommit(current, data, selectionIdentity)
  }

  if (isEditorTransformCancelMessage(data)) {
    return {
      selectionIdentity,
      publishPreview: null,
      state: {
        ...current,
        transformPreview: null,
        transformCommit: null,
        transformCancelSequence: current.transformCancelSequence + 1,
      },
    }
  }

  if (isEditorShortcutMessage(data)) {
    return {
      selectionIdentity,
      state: {
        ...current,
        lastShortcutRequest: {
          ...data,
          sequence: (current.lastShortcutRequest?.sequence ?? 0) + 1,
        },
      },
    }
  }

  if (isEditorInsertRequestMessage(data)) {
    return { selectionIdentity, state: { ...current, lastInsertRequest: data } }
  }

  if (isEditorDeleteRequestMessage(data)) {
    return { selectionIdentity, state: { ...current, lastDeleteRequest: data } }
  }

  if (isEditorErrorMessage(data)) {
    return {
      selectionIdentity,
      editorError: { message: data.message, code: data.code },
      state: { ...current, editorError: data.message },
    }
  }

  return { selectionIdentity, state: current }
}
