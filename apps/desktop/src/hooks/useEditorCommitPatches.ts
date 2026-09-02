import { useEffect } from 'react'

import { buildTextBoxInsertOperation } from '@/lib/editor/deck-editor-patches'
import { getSelectionSetBlockReason } from '@/lib/editor/editor-selection-set'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import type { DeckEditorBridgeState } from '@/lib/editor/editor-bridge-state.ts'
import type { EditorSelectionInfo, EditorTool } from '@ark/editor-runtime'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import type { DeckTextEditCommit } from '@/lib/editor/deck-text-edit.ts'

import type { EditorPatchSession } from './useEditorPatchSession.ts'

type PatchOperations = (
  operations: DeckElementPatchOperation[],
  activeSlideIndex: number,
  summary: string,
) => Promise<DeckPreviewPatchResult | undefined>

export type UseEditorRuntimePatchesOptions = {
  activeSlideIndex: number
  beginLivePatch: (elementId: string) => boolean
  completeLivePatch: (
    result: DeckPreviewPatchResult | undefined,
    sync?: { fromElementId: string; slideIndex: number; managed?: boolean },
  ) => void
  duplicateElement: (
    elementId: string,
    slideIndex: number,
    slideId: string | null,
  ) => Promise<DeckPreviewPatchResult | undefined> | undefined
  editChromeActive: boolean
  editorReady: boolean
  goToSlide: (slideIndex: number) => void
  handleDuplicateSelection: () => void
  handleRedo: () => void
  handleUndo: () => void
  iframeKey: string
  isTextEditSaving: boolean
  lastDeleteRequest: DeckEditorBridgeState['lastDeleteRequest']
  lastInsertRequest: DeckEditorBridgeState['lastInsertRequest']
  lastShortcutRequest: DeckEditorBridgeState['lastShortcutRequest']
  lastTextCommit: DeckEditorBridgeState['lastTextCommit']
  onCommitTextEdit?: (commit: DeckTextEditCommit) => Promise<DeckPreviewPatchResult | undefined>
  onPatchEditorOperations?: PatchOperations
  onSelectElement: (elementId: string, slideIndex: number) => void
  onSelectTool: (tool: EditorTool) => void
  previewContentRevision: number
  rollbackLivePatch: () => void
  scheduleReselect: () => void
  selection: EditorSelectionInfo | null
  selectionSet: EditorSelectionInfo[]
  session: EditorPatchSession
  textEditActive: boolean
  transformCommit: DeckEditorBridgeState['transformCommit']
  transformPreview: DeckEditorBridgeState['transformPreview']
}

function useEditorTextCommitPatch(options: UseEditorRuntimePatchesOptions) {
  const {
    activeSlideIndex,
    beginLivePatch,
    completeLivePatch,
    lastTextCommit,
    onCommitTextEdit,
    rollbackLivePatch,
    scheduleReselect,
    session,
  } = options
  const { pendingReselectRef, preserveSlideIndexRef, processed, scopeGenerationRef } = session

  useEffect(() => {
    if (!lastTextCommit || !onCommitTextEdit) return
    const key = `${lastTextCommit.elementId}:${lastTextCommit.slideIndex}:${lastTextCommit.originalText}:${lastTextCommit.text}`
    if (processed.text.current === key) return
    processed.text.current = key
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
        processed.text.current = null
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
    pendingReselectRef,
    preserveSlideIndexRef,
    processed.text,
    rollbackLivePatch,
    scheduleReselect,
    scopeGenerationRef,
  ])
}

function useEditorInsertPatch(options: UseEditorRuntimePatchesOptions) {
  const { activeSlideIndex, lastInsertRequest, onPatchEditorOperations, onSelectTool, session } =
    options
  const { preserveSlideIndexRef, processed, scopeGenerationRef } = session

  useEffect(() => {
    if (!lastInsertRequest || !onPatchEditorOperations) return
    const key = `${lastInsertRequest.kind}:${lastInsertRequest.slideIndex}:${lastInsertRequest.geometry.x}:${lastInsertRequest.geometry.y}:${lastInsertRequest.geometry.width}:${lastInsertRequest.geometry.height}`
    if (processed.insert.current === key) return
    processed.insert.current = key
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
        processed.insert.current = null
        preserveSlideIndexRef.current = null
      })
  }, [
    activeSlideIndex,
    lastInsertRequest,
    onPatchEditorOperations,
    onSelectTool,
    preserveSlideIndexRef,
    processed.insert,
    scopeGenerationRef,
  ])
}

function useEditorDeletePatch(options: UseEditorRuntimePatchesOptions) {
  const { activeSlideIndex, lastDeleteRequest, onPatchEditorOperations, selectionSet, session } =
    options
  const { preserveSlideIndexRef, processed, scopeGenerationRef } = session

  useEffect(() => {
    if (!lastDeleteRequest || !onPatchEditorOperations) return
    const key = `${lastDeleteRequest.elementId}:${lastDeleteRequest.slideIndex}`
    if (processed.delete.current === key) return
    const generation = scopeGenerationRef.current
    const targets =
      selectionSet.length > 0
        ? selectionSet
        : [
            {
              elementId: lastDeleteRequest.elementId,
              slideIndex: lastDeleteRequest.slideIndex,
            },
          ]
    if (getSelectionSetBlockReason(selectionSet)) {
      return
    }
    processed.delete.current = key
    preserveSlideIndexRef.current = activeSlideIndex
    void onPatchEditorOperations(
      targets.map((item) => ({
        op: 'delete_element' as const,
        elementId: item.elementId,
        slideIndex: item.slideIndex,
        ...('slideId' in item && item.slideId ? { slideId: item.slideId } : {}),
      })),
      lastDeleteRequest.slideIndex,
      targets.length === 1 ? 'Deleted element in preview' : 'Deleted selected elements in preview',
    ).catch(() => {
      if (scopeGenerationRef.current !== generation) return
      processed.delete.current = null
      preserveSlideIndexRef.current = null
    })
  }, [
    activeSlideIndex,
    lastDeleteRequest,
    onPatchEditorOperations,
    preserveSlideIndexRef,
    processed.delete,
    scopeGenerationRef,
    selectionSet,
  ])
}

export function useEditorCommitPatches(options: UseEditorRuntimePatchesOptions) {
  useEditorTextCommitPatch(options)
  useEditorInsertPatch(options)
  useEditorDeletePatch(options)
}
