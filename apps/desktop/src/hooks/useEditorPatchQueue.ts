import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { pickStableChangedElementId } from '@/lib/editor/deck-editor-patches'
import {
  buildImageInsertOperation,
  prepareImageInsertFromFile,
} from '@/lib/editor/deck-image-insert'
import { isTextEditableSelection } from '@/lib/editor/deck-text-edit'
import { getSelectionSetBlockReason } from '@/lib/editor/editor-selection-set'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import type { EditorSelectionInfo, EditorTool } from '@ark/editor-runtime'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import type { ImageFitMode } from '@ark/deck/document/image.ts'

import type { EditorPatchSession } from './useEditorPatchSession.ts'

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
  const { pendingReselectRef, preserveSlideIndexRef, scopeGenerationRef } = session

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

  const scheduleReselect = useCallback(() => {
    if (!selection?.elementId) {
      return
    }

    pendingReselectRef.current = {
      elementId: selection.elementId,
      slideIndex: selection.slideIndex,
      iframeKey,
    }
  }, [iframeKey, pendingReselectRef, selection])

  const finishLivePatchAndClearDeferred = useCallback(
    (result: DeckPreviewPatchResult | undefined) => {
      finishLivePatch(result)
      preserveSlideIndexRef.current = null
      pendingReselectRef.current = null
    },
    [finishLivePatch, pendingReselectRef, preserveSlideIndexRef],
  )

  const completeLivePatch = useCallback(
    (
      result: DeckPreviewPatchResult | undefined,
      sync?: { fromElementId: string; slideIndex: number; managed?: boolean },
    ) => {
      const keptLive = Boolean(result?.deck?.html)
      if (keptLive) {
        if (sync && onAssignElementId && result) {
          const toElementId = pickStableChangedElementId(result.patch.changedElementIds)
          if (toElementId && toElementId !== sync.fromElementId) {
            onAssignElementId(sync.fromElementId, toElementId, sync.slideIndex, sync.managed)
          }
        }
        finishLivePatchAndClearDeferred(result)
        return
      }

      finishLivePatch(result)
    },
    [finishLivePatch, finishLivePatchAndClearDeferred, onAssignElementId],
  )

  const handleInspectorApply = useCallback(
    (operations: DeckElementPatchOperation[], summary: string) => {
      if (!selection || !onPatchEditorOperations || operations.length === 0) {
        return
      }

      preserveSlideIndexRef.current = selection.slideIndex
      scheduleReselect()
      void onPatchEditorOperations(operations, selection.slideIndex, summary).catch(() => {
        pendingReselectRef.current = null
        preserveSlideIndexRef.current = null
      })
    },
    [
      onPatchEditorOperations,
      pendingReselectRef,
      preserveSlideIndexRef,
      scheduleReselect,
      selection,
    ],
  )

  const handleDeleteSelection = useCallback(() => {
    if (!selection || !canModifySelection || !onPatchEditorOperations) {
      return
    }

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
  }, [canModifySelection, onPatchEditorOperations, selection, selectionSet])

  const duplicateElement = useCallback(
    (elementId: string, slideIndex: number, slideId: string | null) =>
      onPatchEditorOperations?.(
        [
          {
            op: 'duplicate_element',
            elementId,
            slideIndex,
            ...(slideId ? { slideId } : {}),
          },
        ],
        slideIndex,
        'Duplicated element in preview',
      ),
    [onPatchEditorOperations],
  )

  const handleDuplicateSelection = useCallback(() => {
    if (
      !selection ||
      selection.locked ||
      !editChromeActive ||
      textEditActive ||
      !onPatchEditorOperations
    ) {
      return
    }

    void duplicateElement(selection.elementId, selection.slideIndex, selection.slideId)
  }, [duplicateElement, editChromeActive, onPatchEditorOperations, selection, textEditActive])

  const handleReorderSelection = useCallback(
    (direction: 'front' | 'back') => {
      if (!selection || !selection.managed || !canModifySelection || !onPatchEditorOperations) {
        return
      }

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
    },
    [canModifySelection, onPatchEditorOperations, scheduleReselect, selection],
  )

  const handleUndo = useCallback(() => {
    if (!canUndo || !onUndo || textEditActive || isTextEditSaving) {
      return
    }

    preserveSlideIndexRef.current = preserveUndoSlideIndex ?? activeSlideIndex
    void onUndo()
  }, [
    activeSlideIndex,
    canUndo,
    isTextEditSaving,
    onUndo,
    preserveSlideIndexRef,
    preserveUndoSlideIndex,
    textEditActive,
  ])

  const handleRedo = useCallback(() => {
    if (!canRedo || !onRedo || textEditActive || isTextEditSaving) {
      return
    }

    preserveSlideIndexRef.current = preserveRedoSlideIndex ?? activeSlideIndex
    void onRedo()
  }, [
    activeSlideIndex,
    canRedo,
    isTextEditSaving,
    onRedo,
    preserveRedoSlideIndex,
    preserveSlideIndexRef,
    textEditActive,
  ])

  const handleInsertImageFile = useCallback(
    async (file: File, position?: { x: number; y: number }) => {
      if (!onPatchEditorOperations || !scopeKey) {
        toast.error('Save the deck before inserting images')
        return
      }

      try {
        const generation = scopeGenerationRef.current
        const prepared = await prepareImageInsertFromFile(scopeKey, file, position)
        if (scopeGenerationRef.current !== generation) {
          return
        }
        preserveSlideIndexRef.current = activeSlideIndex
        await onPatchEditorOperations(
          [buildImageInsertOperation(activeSlideIndex, prepared, null)],
          activeSlideIndex,
          'Inserted image in preview',
        )
        onSelectTool('select')
      } catch (insertError) {
        toast.error(
          insertError instanceof Error ? insertError.message : 'Could not insert the image',
        )
      }
    },
    [
      activeSlideIndex,
      onPatchEditorOperations,
      onSelectTool,
      preserveSlideIndexRef,
      scopeGenerationRef,
      scopeKey,
    ],
  )

  const handleImageAltChange = useCallback(
    (alt: string) => {
      if (!selection || !selectedImage || !onPatchEditorOperations) {
        return
      }

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
    },
    [onPatchEditorOperations, scheduleReselect, selectedImage, selection],
  )

  const handleImageFitChange = useCallback(
    (fit: ImageFitMode) => {
      if (!selection || !selectedImage || !onPatchEditorOperations) {
        return
      }

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
    },
    [onPatchEditorOperations, scheduleReselect, scopeKey, selectedImage, selection],
  )

  return {
    canEditSelectedText,
    handleInsertImageFile,
    handleInspectorApply,
    handleRedo,
    handleUndo,
    live: { completeLivePatch, duplicateElement, scheduleReselect, selectionSet },
    selectedImage,
    selectedImageAlt,
    selectedImageFit,
    selectionActions: {
      delete: handleDeleteSelection,
      duplicate: handleDuplicateSelection,
      imageAlt: handleImageAltChange,
      imageFit: handleImageFitChange,
      reorder: handleReorderSelection,
    },
  }
}
