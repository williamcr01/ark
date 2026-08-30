import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  buildTextBoxInsertOperation,
  buildTransformPatchOperations,
} from '@/lib/deck-editor-patches'
import { buildImageInsertOperation, prepareImageInsertFromFile } from '@/lib/deck-image-insert'
import { isTextEditableSelection } from '@/lib/deck-text-edit'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import type { DeckEditorBridgeState } from '@/hooks/useDeckEditorBridge'
import type { EditorSelectionInfo, EditorTool } from '@ark/editor-runtime/deck-editor-bridge.ts'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import type { ImageFitMode } from '@ark/deck/document/image.ts'
import { STABLE_ELEMENT_ID_PREFIX } from '@ark/deck/document/metadata.ts'

type PatchOperations = (
  operations: DeckElementPatchOperation[],
  activeSlideIndex: number,
  summary: string,
) => Promise<DeckPreviewPatchResult | undefined>

export type DeckTextEditCommit = {
  elementId: string
  slideIndex: number
  slideId: string | null
  text: string
  originalText: string | null
}

type UseDeckEditorPatchCoordinatorOptions = {
  activeSlideIndex: number
  canRedo: boolean
  canUndo: boolean
  editChromeActive: boolean
  editorReady: boolean
  geometry: DeckEditorBridgeState['geometry']
  iframeKey: string
  isTextEditSaving: boolean
  lastDeleteRequest: DeckEditorBridgeState['lastDeleteRequest']
  lastInsertRequest: DeckEditorBridgeState['lastInsertRequest']
  lastShortcutRequest: DeckEditorBridgeState['lastShortcutRequest']
  lastTextCommit: DeckEditorBridgeState['lastTextCommit']
  onCommitTextEdit?: (commit: DeckTextEditCommit) => Promise<DeckPreviewPatchResult | undefined>
  onPatchEditorOperations?: PatchOperations
  onRedo?: () => void | Promise<void>
  onSelectElement: (elementId: string, slideIndex: number) => void
  onSelectTool: (tool: EditorTool) => void
  onUndo?: () => void | Promise<void>
  preserveRedoSlideIndex?: number | null
  preserveUndoSlideIndex?: number | null
  /** Bumps whenever the preview content changed, by reload or by slide patch. */
  previewContentRevision: number
  selection: EditorSelectionInfo | null
  scopeKey: string | null
  textEditActive: boolean
  transformCancelSequence: number
  transformCommit: DeckEditorBridgeState['transformCommit']
  transformPreview: DeckEditorBridgeState['transformPreview']
  beginLivePatch: (elementId: string) => boolean
  finishLivePatch: (result: DeckPreviewPatchResult | undefined) => void
  goToSlide: (slideIndex: number) => void
  rollbackLivePatch: () => void
  /** Stamp a stable id onto the live iframe DOM after a live patch. */
  onAssignElementId?: (
    fromElementId: string,
    toElementId: string,
    slideIndex: number,
    managed?: boolean,
  ) => void
}

export function useDeckEditorPatchCoordinator({
  activeSlideIndex,
  canRedo,
  canUndo,
  editChromeActive,
  editorReady,
  geometry,
  iframeKey,
  isTextEditSaving,
  lastDeleteRequest,
  lastInsertRequest,
  lastShortcutRequest,
  lastTextCommit,
  onCommitTextEdit,
  onPatchEditorOperations,
  onRedo,
  onSelectElement,
  onSelectTool,
  onUndo,
  preserveRedoSlideIndex,
  preserveUndoSlideIndex,
  previewContentRevision,
  selection,
  scopeKey,
  textEditActive,
  transformCancelSequence,
  transformCommit,
  transformPreview,
  beginLivePatch,
  finishLivePatch,
  goToSlide,
  rollbackLivePatch,
  onAssignElementId,
}: UseDeckEditorPatchCoordinatorOptions) {
  const [imageFitOverride, setImageFitOverride] = useState<{
    scopeKey: string | null
    elementId: string
    fit: ImageFitMode
  } | null>(null)
  const preserveSlideIndexRef = useRef<number | null>(null)
  const pendingReselectRef = useRef<{
    elementId: string
    slideIndex: number
    iframeKey: string
  } | null>(null)
  const processedTextCommitRef = useRef<string | null>(null)
  const processedInsertRequestRef = useRef<string | null>(null)
  const processedDeleteRequestRef = useRef<string | null>(null)
  const processedShortcutRequestRef = useRef<string | null>(null)
  const processedTransformCommitRef = useRef<string | null>(null)
  const pendingTransformPatchRef = useRef<Promise<DeckPreviewPatchResult | undefined> | null>(null)
  const committedGeometryRef = useRef<DeckEditorBridgeState['geometry']>(null)
  const transformStartGeometryRef = useRef<DeckEditorBridgeState['geometry']>(null)
  const isTransformingRef = useRef(false)
  const scopeGenerationRef = useRef(0)

  useLayoutEffect(() => {
    scopeGenerationRef.current += 1
    processedTextCommitRef.current = null
    processedInsertRequestRef.current = null
    processedDeleteRequestRef.current = null
    processedShortcutRequestRef.current = null
    processedTransformCommitRef.current = null
    pendingTransformPatchRef.current = null
    pendingReselectRef.current = null
    preserveSlideIndexRef.current = null
    committedGeometryRef.current = null
    transformStartGeometryRef.current = null
    isTransformingRef.current = false
  }, [scopeKey])

  const canEditSelectedText = editChromeActive && isTextEditableSelection(selection)
  const canModifySelection =
    selection !== null && !selection.locked && editChromeActive && !textEditActive
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
  }, [iframeKey, selection])

  const pickStableChangedElementId = useCallback((changedElementIds: string[]) => {
    // Manual-edit commits are single-op today; prefer an explicit stable id when
    // present, otherwise fall back to the sole changed id.
    return (
      changedElementIds.find((id) => id.startsWith(STABLE_ELEMENT_ID_PREFIX)) ??
      (changedElementIds.length === 1 ? changedElementIds[0] : undefined)
    )
  }, [])

  // Live patches skip iframe reload, so deferred slide/reselection intents must
  // not survive into a later unrelated HTML/frame update — but only when the
  // live DOM is actually retained (result includes deck.html).
  const finishLivePatchAndClearDeferred = useCallback(
    (result: DeckPreviewPatchResult | undefined) => {
      finishLivePatch(result)
      preserveSlideIndexRef.current = null
      pendingReselectRef.current = null
    },
    [finishLivePatch],
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

      // No deck.html → iframe will reload with canonical HTML. Keep the remapped
      // pendingReselect so selection survives (assign-id is pointless on a dying DOM).
      finishLivePatch(result)
    },
    [
      finishLivePatch,
      finishLivePatchAndClearDeferred,
      onAssignElementId,
      pickStableChangedElementId,
    ],
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
    [onPatchEditorOperations, scheduleReselect, selection],
  )

  const handleDeleteSelection = useCallback(() => {
    if (!selection || !canModifySelection || !onPatchEditorOperations) {
      return
    }

    void onPatchEditorOperations(
      [
        {
          op: 'delete_element',
          elementId: selection.elementId,
          slideIndex: selection.slideIndex,
          ...(selection.slideId ? { slideId: selection.slideId } : {}),
        },
      ],
      selection.slideIndex,
      'Deleted element in preview',
    )
  }, [canModifySelection, onPatchEditorOperations, selection])

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
  }, [activeSlideIndex, canUndo, isTextEditSaving, onUndo, preserveUndoSlideIndex, textEditActive])

  const handleRedo = useCallback(() => {
    if (!canRedo || !onRedo || textEditActive || isTextEditSaving) {
      return
    }

    preserveSlideIndexRef.current = preserveRedoSlideIndex ?? activeSlideIndex
    void onRedo()
  }, [activeSlideIndex, canRedo, isTextEditSaving, onRedo, preserveRedoSlideIndex, textEditActive])

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
    [activeSlideIndex, onPatchEditorOperations, onSelectTool, scopeKey],
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

  useEffect(() => {
    if (isTransformingRef.current || transformPreview) return
    committedGeometryRef.current = geometry
  }, [geometry, transformPreview])

  useEffect(() => {
    if (!transformPreview || isTransformingRef.current) return
    isTransformingRef.current = true
    transformStartGeometryRef.current = committedGeometryRef.current
  }, [transformPreview])

  useEffect(() => {
    if (transformCancelSequence === 0) return
    isTransformingRef.current = false
    transformStartGeometryRef.current = null
  }, [transformCancelSequence])

  useEffect(() => {
    if (!lastTextCommit || !onCommitTextEdit) return
    const key = `${lastTextCommit.elementId}:${lastTextCommit.slideIndex}:${lastTextCommit.originalText}:${lastTextCommit.text}`
    if (processedTextCommitRef.current === key) return
    processedTextCommitRef.current = key
    if (lastTextCommit.text === lastTextCommit.originalText) return

    preserveSlideIndexRef.current = activeSlideIndex
    scheduleReselect()
    const keepLivePreview = beginLivePatch(lastTextCommit.elementId)
    const generation = scopeGenerationRef.current
    void onCommitTextEdit(lastTextCommit)
      .then((result) => {
        if (scopeGenerationRef.current !== generation) return
        if (keepLivePreview) {
          completeLivePatch(result, {
            fromElementId: lastTextCommit.elementId,
            slideIndex: lastTextCommit.slideIndex,
          })
        }
      })
      .catch(() => {
        if (scopeGenerationRef.current !== generation) return
        processedTextCommitRef.current = null
        preserveSlideIndexRef.current = null
        pendingReselectRef.current = null
        if (keepLivePreview) rollbackLivePatch()
      })
  }, [
    activeSlideIndex,
    beginLivePatch,
    completeLivePatch,
    lastTextCommit,
    onCommitTextEdit,
    rollbackLivePatch,
    scheduleReselect,
  ])

  useEffect(() => {
    if (!lastInsertRequest || !onPatchEditorOperations) return
    const key = `${lastInsertRequest.kind}:${lastInsertRequest.slideIndex}:${lastInsertRequest.geometry.x}:${lastInsertRequest.geometry.y}:${lastInsertRequest.geometry.width}:${lastInsertRequest.geometry.height}`
    if (processedInsertRequestRef.current === key) return
    processedInsertRequestRef.current = key
    preserveSlideIndexRef.current = activeSlideIndex
    const generation = scopeGenerationRef.current
    void onPatchEditorOperations(
      [buildTextBoxInsertOperation(lastInsertRequest.slideIndex, lastInsertRequest.geometry, null)],
      lastInsertRequest.slideIndex,
      'Inserted text box in preview',
    )
      .then(() => {
        if (scopeGenerationRef.current === generation) onSelectTool('select')
      })
      .catch(() => {
        if (scopeGenerationRef.current !== generation) return
        processedInsertRequestRef.current = null
        preserveSlideIndexRef.current = null
      })
  }, [activeSlideIndex, lastInsertRequest, onPatchEditorOperations, onSelectTool])

  useEffect(() => {
    if (!lastDeleteRequest || !onPatchEditorOperations) return
    const key = `${lastDeleteRequest.elementId}:${lastDeleteRequest.slideIndex}`
    if (processedDeleteRequestRef.current === key) return
    processedDeleteRequestRef.current = key
    preserveSlideIndexRef.current = activeSlideIndex
    const generation = scopeGenerationRef.current
    void onPatchEditorOperations(
      [
        {
          op: 'delete_element',
          elementId: lastDeleteRequest.elementId,
          slideIndex: lastDeleteRequest.slideIndex,
        },
      ],
      lastDeleteRequest.slideIndex,
      'Deleted element in preview',
    ).catch(() => {
      if (scopeGenerationRef.current !== generation) return
      processedDeleteRequestRef.current = null
      preserveSlideIndexRef.current = null
    })
  }, [activeSlideIndex, lastDeleteRequest, onPatchEditorOperations])

  useEffect(() => {
    if (!transformCommit || !onPatchEditorOperations) return
    const key = `${transformCommit.elementId}:${transformCommit.slideIndex}:${transformCommit.geometry.x}:${transformCommit.geometry.y}:${transformCommit.geometry.width}:${transformCommit.geometry.height}:${transformCommit.adopted ? 'adopted' : 'managed'}`
    if (processedTransformCommitRef.current === key) return

    const operations = buildTransformPatchOperations(
      transformCommit,
      isTransformingRef.current ? transformStartGeometryRef.current : null,
      selection?.slideId ?? null,
    )
    isTransformingRef.current = false
    transformStartGeometryRef.current = null
    if (operations.length === 0) return

    processedTransformCommitRef.current = key
    preserveSlideIndexRef.current = activeSlideIndex
    scheduleReselect()
    const keepLivePreview = beginLivePatch(transformCommit.elementId)
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent -- exactly-once imperative geometry-patch command for a transformCommit arriving over the private editor MessagePort the parent cannot subscribe to (external-subscription predicate); deduped by processedTransformCommitRef
    const patchPromise = onPatchEditorOperations(
      operations,
      transformCommit.slideIndex,
      'Updated element layout in preview',
    )
    const generation = scopeGenerationRef.current
    pendingTransformPatchRef.current = patchPromise
    void patchPromise
      .then((result) => {
        if (scopeGenerationRef.current !== generation) return
        if (transformCommit.adopted) {
          const stableId = pickStableChangedElementId(result?.patch.changedElementIds ?? [])
          const pending = pendingReselectRef.current
          if (stableId && pending?.elementId === transformCommit.elementId) {
            pending.elementId = stableId
          }
        }
        if (keepLivePreview) {
          completeLivePatch(result, {
            fromElementId: transformCommit.elementId,
            slideIndex: transformCommit.slideIndex,
            managed: Boolean(transformCommit.adopted),
          })
        }
      })
      .catch(() => {
        if (scopeGenerationRef.current !== generation) return
        processedTransformCommitRef.current = null
        preserveSlideIndexRef.current = null
        pendingReselectRef.current = null
        if (keepLivePreview) rollbackLivePatch()
      })
      .finally(() => {
        if (scopeGenerationRef.current !== generation) return
        if (pendingTransformPatchRef.current === patchPromise) {
          pendingTransformPatchRef.current = null
        }
      })
  }, [
    activeSlideIndex,
    beginLivePatch,
    completeLivePatch,
    onPatchEditorOperations,
    pickStableChangedElementId,
    rollbackLivePatch,
    scheduleReselect,
    selection?.slideId,
    transformCommit,
  ])

  useEffect(() => {
    if (!lastShortcutRequest) return
    const key = `${iframeKey}:${lastShortcutRequest.sequence}`
    if (processedShortcutRequestRef.current === key) return
    processedShortcutRequestRef.current = key

    if (lastShortcutRequest.action === 'duplicate') {
      if (!selection || selection.locked || !editChromeActive || textEditActive) return
      const pendingTransform = pendingTransformPatchRef.current
      if (pendingTransform) {
        const generation = scopeGenerationRef.current
        const { elementId, slideIndex, slideId } = selection
        void pendingTransform
          .then((result) => {
            if (scopeGenerationRef.current !== generation) return
            return duplicateElement(
              result?.patch.changedElementIds[0] ?? elementId,
              slideIndex,
              slideId,
            )
          })
          .catch(() => undefined)
        return
      }
      if (transformPreview || isTextEditSaving) return
      if (transformCommit) {
        void duplicateElement(
          pendingReselectRef.current?.elementId ?? selection.elementId,
          selection.slideIndex,
          selection.slideId,
        )
        return
      }
      // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent -- exactly-once imperative duplicate command for a shortcut request arriving over the private editor MessagePort the parent cannot subscribe to (external-subscription predicate); deduped by processedShortcutRequestRef
      handleDuplicateSelection()
      return
    }

    if (transformPreview || pendingTransformPatchRef.current || isTextEditSaving) return
    if (lastShortcutRequest.action === 'undo') handleUndo()
    else handleRedo()
  }, [
    duplicateElement,
    editChromeActive,
    handleDuplicateSelection,
    handleRedo,
    handleUndo,
    iframeKey,
    isTextEditSaving,
    lastShortcutRequest,
    selection,
    textEditActive,
    transformCommit,
    transformPreview,
  ])

  useEffect(() => {
    if (preserveSlideIndexRef.current === null) return
    const slideIndex = preserveSlideIndexRef.current
    preserveSlideIndexRef.current = null
    goToSlide(slideIndex)
  }, [goToSlide, iframeKey, previewContentRevision])

  useEffect(() => {
    const pending = pendingReselectRef.current
    if (!pending) return
    if (!editChromeActive) {
      pendingReselectRef.current = null
      return
    }
    if (pending.iframeKey === iframeKey) return
    if (!editorReady || activeSlideIndex !== pending.slideIndex) return
    if (selection?.elementId) {
      pendingReselectRef.current = null
      return
    }
    pendingReselectRef.current = null
    onSelectElement(pending.elementId, pending.slideIndex)
  }, [
    activeSlideIndex,
    editChromeActive,
    editorReady,
    iframeKey,
    onSelectElement,
    selection?.elementId,
  ])

  return {
    canEditSelectedText,
    handleDeleteSelection,
    handleDuplicateSelection,
    handleImageAltChange,
    handleImageFitChange,
    handleInsertImageFile,
    handleInspectorApply,
    handleRedo,
    handleReorderSelection,
    handleUndo,
    selectedImage,
    selectedImageAlt,
    selectedImageFit,
  }
}
