import { useEffect } from 'react'

import {
  buildTransformPatchOperations,
  pickStableChangedElementId,
} from '@/lib/editor/deck-editor-patches'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import type { DeckEditorBridgeState } from '@/lib/editor/editor-bridge-state.ts'
import type { EditorSelectionInfo } from '@ark/editor-runtime'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'

import type { EditorPatchSession } from './useEditorPatchSession.ts'

type PatchOperations = (
  operations: DeckElementPatchOperation[],
  activeSlideIndex: number,
  summary: string,
) => Promise<DeckPreviewPatchResult | undefined>

export type UseEditorDragCommitOptions = {
  activeSlideIndex: number
  beginLivePatch: (elementId: string) => boolean
  completeLivePatch: (
    result: DeckPreviewPatchResult | undefined,
    sync?: { fromElementId: string; slideIndex: number; managed?: boolean },
  ) => void
  geometry: DeckEditorBridgeState['geometry']
  onPatchEditorOperations?: PatchOperations
  rollbackLivePatch: () => void
  scheduleReselect: () => void
  selection: EditorSelectionInfo | null
  session: EditorPatchSession
  transformCancelSequence: number
  transformCommit: DeckEditorBridgeState['transformCommit']
  transformPreview: DeckEditorBridgeState['transformPreview']
}

export function useEditorDragCommit({
  activeSlideIndex,
  beginLivePatch,
  completeLivePatch,
  geometry,
  onPatchEditorOperations,
  rollbackLivePatch,
  scheduleReselect,
  selection,
  session,
  transformCancelSequence,
  transformCommit,
  transformPreview,
}: UseEditorDragCommitOptions) {
  const {
    pendingReselectRef,
    pendingTransformPatchRef,
    preserveSlideIndexRef,
    processed,
    scopeGenerationRef,
    transform,
  } = session

  useEffect(() => {
    if (transform.isTransformingRef.current || transformPreview) return
    transform.committedGeometryRef.current = geometry
  }, [geometry, transform, transformPreview])

  useEffect(() => {
    if (!transformPreview || transform.isTransformingRef.current) return
    transform.isTransformingRef.current = true
    transform.startGeometryRef.current = transform.committedGeometryRef.current
  }, [transform, transformPreview])

  useEffect(() => {
    if (transformCancelSequence === 0) return
    transform.isTransformingRef.current = false
    transform.startGeometryRef.current = null
  }, [transform, transformCancelSequence])

  useEffect(() => {
    if (!transformCommit || !onPatchEditorOperations) return
    const key = `${transformCommit.elementId}:${transformCommit.slideIndex}:${transformCommit.geometry.x}:${transformCommit.geometry.y}:${transformCommit.geometry.width}:${transformCommit.geometry.height}:${transformCommit.adopted ? 'adopted' : 'managed'}`
    if (processed.transform.current === key) return

    const operations = [
      ...buildTransformPatchOperations(
        transformCommit,
        transform.isTransformingRef.current ? transform.startGeometryRef.current : null,
        selection?.slideId ?? null,
      ),
      ...(transformCommit.companions ?? []).flatMap((companion) =>
        buildTransformPatchOperations(
          { type: 'ark:editor-transform-commit', ...companion },
          null,
          selection?.slideId ?? null,
        ),
      ),
    ]
    transform.isTransformingRef.current = false
    transform.startGeometryRef.current = null
    if (operations.length === 0) return

    processed.transform.current = key
    preserveSlideIndexRef.current = activeSlideIndex
    scheduleReselect()
    const keepLivePreview =
      !(transformCommit.companions && transformCommit.companions.length > 0) &&
      beginLivePatch(transformCommit.elementId)
    const patchPromise = onPatchEditorOperations(
      operations,
      transformCommit.slideIndex,
      transformCommit.companions?.length
        ? 'Updated selected element layout in preview'
        : 'Updated element layout in preview',
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
        processed.transform.current = null
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
    pendingReselectRef,
    pendingTransformPatchRef,
    preserveSlideIndexRef,
    processed.transform,
    rollbackLivePatch,
    scheduleReselect,
    scopeGenerationRef,
    selection?.slideId,
    transform,
    transformCommit,
  ])
}
