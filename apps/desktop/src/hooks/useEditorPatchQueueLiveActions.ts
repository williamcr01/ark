import { useCallback } from 'react'

import type { EditorSelectionInfo, EditorTool } from '@ark/editor-runtime'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'

import type { EditorPatchSession } from './useEditorPatchSession.ts'
import { insertImageFromFile } from './editor-patch-queue-live.ts'

type PatchOperations = (
  operations: DeckElementPatchOperation[],
  activeSlideIndex: number,
  summary: string,
) => Promise<DeckPreviewPatchResult | undefined>

export function useEditorPatchQueueLiveActions(options: {
  activeSlideIndex: number
  onPatchEditorOperations?: PatchOperations
  onSelectTool: (tool: EditorTool) => void
  scopeKey: string | null
  selection: EditorSelectionInfo | null
  session: EditorPatchSession
  scheduleReselect: () => void
}) {
  const {
    activeSlideIndex,
    onPatchEditorOperations,
    onSelectTool,
    scopeKey,
    selection,
    session,
    scheduleReselect,
  } = options
  const { pendingReselectRef, preserveSlideIndexRef, scopeGenerationRef } = session

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

  const handleInsertImageFile = useCallback(
    async (file: File, position?: { x: number; y: number }) => {
      await insertImageFromFile({
        file,
        position,
        scopeKey,
        scopeGenerationRef,
        preserveSlideIndexRef,
        activeSlideIndex,
        onPatchEditorOperations,
        onSelectTool,
      })
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

  return { duplicateElement, handleInsertImageFile, handleInspectorApply }
}
