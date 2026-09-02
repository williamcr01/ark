import { useCallback } from 'react'

import type { EditorSelectionInfo } from '@ark/editor-runtime'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import type { ImageFitMode } from '@ark/deck/document/image.ts'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'

import type { EditorPatchSession } from './useEditorPatchSession.ts'

type PatchOperations = (
  operations: DeckElementPatchOperation[],
  activeSlideIndex: number,
  summary: string,
) => Promise<DeckPreviewPatchResult | undefined>

function deleteSelectedElements(
  selection: EditorSelectionInfo,
  selectionSet: EditorSelectionInfo[],
  onPatchEditorOperations: PatchOperations,
) {
  const targets = selectionSet.filter((item) => !item.locked)
  if (targets.length === 0) {
    return
  }

  void onPatchEditorOperations(
    targets.map((item) => ({
      op: 'delete_element' as const,
      elementId: item.elementId,
      slideIndex: item.slideIndex,
      ...(item.slideId ? { slideId: item.slideId } : {}),
    })),
    selection.slideIndex,
    targets.length === 1 ? 'Deleted element in preview' : 'Deleted selected elements in preview',
  )
}

function reorderSelectedElement(
  selection: EditorSelectionInfo,
  direction: 'front' | 'back',
  onPatchEditorOperations: PatchOperations,
  scheduleReselect: () => void,
) {
  scheduleReselect()
  void onPatchEditorOperations(
    [
      {
        op: 'reorder_element',
        elementId: selection.elementId,
        slideIndex: selection.slideIndex,
        ...(selection.slideId ? { slideId: selection.slideId } : {}),
        direction,
      },
    ],
    selection.slideIndex,
    direction === 'front' ? 'Brought element forward' : 'Sent element backward',
  )
}

function patchSelectedImageAlt(
  selection: EditorSelectionInfo,
  alt: string,
  onPatchEditorOperations: PatchOperations,
  scheduleReselect: () => void,
) {
  scheduleReselect()
  void onPatchEditorOperations(
    [
      {
        op: 'set_attrs',
        elementId: selection.elementId,
        slideIndex: selection.slideIndex,
        ...(selection.slideId ? { slideId: selection.slideId } : {}),
        attrs: { alt },
      },
    ],
    selection.slideIndex,
    'Updated image alt text',
  )
}

function patchSelectedImageFit(
  selection: EditorSelectionInfo,
  fit: ImageFitMode,
  scopeKey: string | null,
  onPatchEditorOperations: PatchOperations,
  scheduleReselect: () => void,
  setImageFitOverride: (
    next: { scopeKey: string | null; elementId: string; fit: ImageFitMode } | null,
  ) => void,
) {
  setImageFitOverride({ scopeKey, elementId: selection.elementId, fit })
  scheduleReselect()
  void onPatchEditorOperations(
    [
      {
        op: 'set_inline_style',
        elementId: selection.elementId,
        slideIndex: selection.slideIndex,
        ...(selection.slideId ? { slideId: selection.slideId } : {}),
        style: { 'object-fit': fit },
      },
      {
        op: 'set_attrs',
        elementId: selection.elementId,
        slideIndex: selection.slideIndex,
        ...(selection.slideId ? { slideId: selection.slideId } : {}),
        attrs: { 'data-ark-fit': fit },
      },
    ],
    selection.slideIndex,
    'Updated image fit mode',
  )
}

type MutationOptions = {
  activeSlideIndex: number
  canModifySelection: boolean
  canRedo: boolean
  canUndo: boolean
  duplicateElement: (
    elementId: string,
    slideIndex: number,
    slideId: string | null,
  ) => Promise<DeckPreviewPatchResult | undefined> | undefined
  editChromeActive: boolean
  isTextEditSaving: boolean
  onPatchEditorOperations?: PatchOperations
  onRedo?: () => void | Promise<void>
  onUndo?: () => void | Promise<void>
  preserveRedoSlideIndex?: number | null
  preserveUndoSlideIndex?: number | null
  scheduleReselect: () => void
  selectedImage: boolean
  selection: EditorSelectionInfo | null
  selectionSet: EditorSelectionInfo[]
  session: EditorPatchSession
  setImageFitOverride: (
    next: { scopeKey: string | null; elementId: string; fit: ImageFitMode } | null,
  ) => void
  scopeKey: string | null
  textEditActive: boolean
}

export function useEditorPatchQueueMutations(options: MutationOptions) {
  const handleDeleteSelection = useCallback(() => {
    if (!options.selection || !options.canModifySelection || !options.onPatchEditorOperations)
      return
    deleteSelectedElements(options.selection, options.selectionSet, options.onPatchEditorOperations)
  }, [options])

  const handleDuplicateSelection = useCallback(() => {
    const {
      selection,
      editChromeActive,
      textEditActive,
      onPatchEditorOperations,
      duplicateElement,
    } = options
    if (
      !selection ||
      selection.locked ||
      !editChromeActive ||
      textEditActive ||
      !onPatchEditorOperations
    )
      return
    void duplicateElement(selection.elementId, selection.slideIndex, selection.slideId)
  }, [options])

  const handleReorderSelection = useCallback(
    (direction: 'front' | 'back') => {
      const { selection, canModifySelection, onPatchEditorOperations, scheduleReselect } = options
      if (!selection || !selection.managed || !canModifySelection || !onPatchEditorOperations)
        return
      reorderSelectedElement(selection, direction, onPatchEditorOperations, scheduleReselect)
    },
    [options],
  )

  const handleUndo = useCallback(() => {
    const {
      canUndo,
      onUndo,
      textEditActive,
      isTextEditSaving,
      session,
      preserveUndoSlideIndex,
      activeSlideIndex,
    } = options
    if (!canUndo || !onUndo || textEditActive || isTextEditSaving) return
    session.preserveSlideIndexRef.current = preserveUndoSlideIndex ?? activeSlideIndex
    void onUndo()
  }, [options])

  const handleRedo = useCallback(() => {
    const {
      canRedo,
      onRedo,
      textEditActive,
      isTextEditSaving,
      session,
      preserveRedoSlideIndex,
      activeSlideIndex,
    } = options
    if (!canRedo || !onRedo || textEditActive || isTextEditSaving) return
    session.preserveSlideIndexRef.current = preserveRedoSlideIndex ?? activeSlideIndex
    void onRedo()
  }, [options])

  const handleImageAltChange = useCallback(
    (alt: string) => {
      const { selection, selectedImage, onPatchEditorOperations, scheduleReselect } = options
      if (!selection || !selectedImage || !onPatchEditorOperations) return
      patchSelectedImageAlt(selection, alt, onPatchEditorOperations, scheduleReselect)
    },
    [options],
  )

  const handleImageFitChange = useCallback(
    (fit: ImageFitMode) => {
      const {
        selection,
        selectedImage,
        onPatchEditorOperations,
        scopeKey,
        scheduleReselect,
        setImageFitOverride,
      } = options
      if (!selection || !selectedImage || !onPatchEditorOperations) return
      patchSelectedImageFit(
        selection,
        fit,
        scopeKey,
        onPatchEditorOperations,
        scheduleReselect,
        setImageFitOverride,
      )
    },
    [options],
  )

  return {
    handleDeleteSelection,
    handleDuplicateSelection,
    handleImageAltChange,
    handleImageFitChange,
    handleRedo,
    handleReorderSelection,
    handleUndo,
  }
}
