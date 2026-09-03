import { useLayoutEffect, useRef } from 'react'

import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import type { DeckEditorBridgeState } from '@/lib/editor/editor-bridge-state.ts'

export type EditorPatchSession = ReturnType<typeof useEditorPatchSession>

export function useEditorPatchSession(scopeKey: string | null) {
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

  return {
    pendingReselectRef,
    pendingTransformPatchRef,
    preserveSlideIndexRef,
    processed: {
      delete: processedDeleteRequestRef,
      insert: processedInsertRequestRef,
      shortcut: processedShortcutRequestRef,
      text: processedTextCommitRef,
      transform: processedTransformCommitRef,
    },
    scopeGenerationRef,
    transform: {
      committedGeometryRef,
      isTransformingRef,
      startGeometryRef: transformStartGeometryRef,
    },
  }
}
