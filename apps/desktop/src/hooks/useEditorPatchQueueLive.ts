import { useCallback } from 'react'

import type { EditorSelectionInfo, EditorTool } from '@ark/editor-runtime'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'

import type { EditorPatchSession } from './useEditorPatchSession.ts'
import { completeLivePatchResult } from './editor-patch-queue-live.ts'
import { useEditorPatchQueueLiveActions } from './useEditorPatchQueueLiveActions.ts'

type PatchOperations = (
  operations: DeckElementPatchOperation[],
  activeSlideIndex: number,
  summary: string,
) => Promise<DeckPreviewPatchResult | undefined>

export function useEditorPatchQueueLive(options: {
  activeSlideIndex: number
  finishLivePatch: (result: DeckPreviewPatchResult | undefined) => void
  iframeKey: string
  onAssignElementId?: (
    fromElementId: string,
    toElementId: string,
    slideIndex: number,
    managed?: boolean,
  ) => void
  onPatchEditorOperations?: PatchOperations
  onSelectTool: (tool: EditorTool) => void
  scopeKey: string | null
  selection: EditorSelectionInfo | null
  session: EditorPatchSession
}) {
  const {
    activeSlideIndex,
    finishLivePatch,
    iframeKey,
    onAssignElementId,
    onPatchEditorOperations,
    onSelectTool,
    scopeKey,
    selection,
    session,
  } = options
  const { pendingReselectRef, preserveSlideIndexRef } = session

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
      completeLivePatchResult(
        result,
        sync,
        onAssignElementId,
        finishLivePatchAndClearDeferred,
        finishLivePatch,
      )
    },
    [finishLivePatch, finishLivePatchAndClearDeferred, onAssignElementId],
  )

  const actions = useEditorPatchQueueLiveActions({
    activeSlideIndex,
    onPatchEditorOperations,
    onSelectTool,
    scopeKey,
    selection,
    session,
    scheduleReselect,
  })

  return {
    completeLivePatch,
    duplicateElement: actions.duplicateElement,
    handleInsertImageFile: actions.handleInsertImageFile,
    handleInspectorApply: actions.handleInspectorApply,
    scheduleReselect,
  }
}
