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

function patchQueueSelection(input: {
  editChromeActive: boolean
  selection: EditorSelectionInfo | null
  selectionSet: EditorSelectionInfo[]
  textEditActive: boolean
}) {
  const selectionBlockReason = getSelectionSetBlockReason(input.selectionSet)
  const selectedImage = Boolean(
    input.selection &&
    !input.selection.locked &&
    (input.selection.editableKind === 'image' || input.selection.tagName === 'img'),
  )
  return {
    canEditSelectedText:
      input.editChromeActive &&
      input.selectionSet.length === 1 &&
      isTextEditableSelection(input.selection),
    canModifySelection:
      input.selection !== null &&
      !selectionBlockReason &&
      input.editChromeActive &&
      !input.textEditActive,
    selectedImage,
    selectedImageAlt: selectedImage ? (input.selection?.textPreview ?? '') : '',
  }
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
  const flags = patchQueueSelection({
    editChromeActive,
    selection,
    selectionSet,
    textEditActive,
  })
  const selectedImageFit: ImageFitMode =
    flags.selectedImage &&
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
    canModifySelection: flags.canModifySelection,
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
    selectedImage: flags.selectedImage,
    selection,
    selectionSet,
    session,
    setImageFitOverride,
    scopeKey,
    textEditActive,
  })

  return {
    canEditSelectedText: flags.canEditSelectedText,
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
    selectedImage: flags.selectedImage,
    selectedImageAlt: flags.selectedImageAlt,
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
