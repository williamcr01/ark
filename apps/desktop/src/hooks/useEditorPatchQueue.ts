import { useMemo, useState } from 'react'

import { isTextEditableSelection } from '@/lib/editor/deck-text-edit'
import { getSelectionSetBlockReason } from '@/lib/editor/editor-selection-set'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import type { EditorSelectionInfo, EditorTool } from '@ark/editor-runtime'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import type { ImageFitMode } from '@ark/deck/document/image.ts'

import type { EditorPatchSession } from './useEditorPatchSession.ts'
import { useEditorPatchQueueLive } from './useEditorPatchQueueLive.ts'
import { useEditorPatchQueueMutations } from './useEditorPatchQueueMutations.ts'

type PatchOperations = (
  operations: DeckElementPatchOperation[],
  activeSlideIndex: number,
  summary: string,
) => Promise<DeckPreviewPatchResult | undefined>

export type UseEditorPatchQueueOptions = {
  activeSlideIndex: number
  canRedo: boolean
  canUndo: boolean
  editChromeActive: boolean
  finishLivePatch: (result: DeckPreviewPatchResult | undefined) => void
  iframeKey: string
  isTextEditSaving: boolean
  onAssignElementId?: (
    fromElementId: string,
    toElementId: string,
    slideIndex: number,
    managed?: boolean,
  ) => void
  onPatchEditorOperations?: PatchOperations
  onRedo?: () => void | Promise<void>
  onSelectTool: (tool: EditorTool) => void
  onUndo?: () => void | Promise<void>
  preserveRedoSlideIndex?: number | null
  preserveUndoSlideIndex?: number | null
  scopeKey: string | null
  selection: EditorSelectionInfo | null
  selections?: EditorSelectionInfo[]
  session: EditorPatchSession
  textEditActive: boolean
}

export function useEditorPatchQueue({
  activeSlideIndex,
  canRedo,
  canUndo,
  editChromeActive,
  finishLivePatch,
  iframeKey,
  isTextEditSaving,
  onAssignElementId,
  onPatchEditorOperations,
  onRedo,
  onSelectTool,
  onUndo,
  preserveRedoSlideIndex,
  preserveUndoSlideIndex,
  scopeKey,
  selection,
  selections = [],
  session,
  textEditActive,
}: UseEditorPatchQueueOptions) {
  const [imageFitOverride, setImageFitOverride] = useState<{
    scopeKey: string | null
    elementId: string
    fit: ImageFitMode
  } | null>(null)

  const selectionSet = useMemo(
    () => (selections.length > 0 ? selections : selection ? [selection] : []),
    [selection, selections],
  )
  const selectionBlockReason = getSelectionSetBlockReason(selectionSet)
  const canEditSelectedText =
    editChromeActive && selectionSet.length === 1 && isTextEditableSelection(selection)
  const canModifySelection =
    selection !== null && !selectionBlockReason && editChromeActive && !textEditActive
  const selectedImage = Boolean(
    selection &&
    !selection.locked &&
    (selection.editableKind === 'image' || selection.tagName === 'img'),
  )
  const selectedImageAlt = selectedImage ? (selection?.textPreview ?? '') : ''
  const selectedImageFit: ImageFitMode =
    selectedImage &&
    imageFitOverride !== null &&
    imageFitOverride.scopeKey === scopeKey &&
    imageFitOverride.elementId === selection?.elementId
      ? imageFitOverride.fit
      : (selection?.imageFit ?? 'contain')

  const live = useEditorPatchQueueLive({
    activeSlideIndex,
    finishLivePatch,
    iframeKey,
    onAssignElementId,
    onPatchEditorOperations,
    onSelectTool,
    scopeKey,
    selection,
    session,
  })
  const mutations = useEditorPatchQueueMutations({
    activeSlideIndex,
    canModifySelection,
    canRedo,
    canUndo,
    duplicateElement: live.duplicateElement,
    editChromeActive,
    isTextEditSaving,
    onPatchEditorOperations,
    onRedo,
    onUndo,
    preserveRedoSlideIndex,
    preserveUndoSlideIndex,
    scheduleReselect: live.scheduleReselect,
    selectedImage,
    selection,
    selectionSet,
    session,
    setImageFitOverride,
    scopeKey,
    textEditActive,
  })

  return {
    canEditSelectedText,
    handleInsertImageFile: live.handleInsertImageFile,
    handleInspectorApply: live.handleInspectorApply,
    handleRedo: mutations.handleRedo,
    handleUndo: mutations.handleUndo,
    live: {
      completeLivePatch: live.completeLivePatch,
      duplicateElement: live.duplicateElement,
      scheduleReselect: live.scheduleReselect,
      selectionSet,
    },
    selectedImage,
    selectedImageAlt,
    selectedImageFit,
    selectionActions: {
      delete: mutations.handleDeleteSelection,
      duplicate: mutations.handleDuplicateSelection,
      imageAlt: mutations.handleImageAltChange,
      imageFit: mutations.handleImageFitChange,
      reorder: mutations.handleReorderSelection,
    },
  }
}
