import { useCallback, useMemo, useRef, type MutableRefObject, type RefObject } from 'react'

import { DeckPreviewView } from '@/components/DeckPreviewView'
import { useDeckEditorLayer } from '@/hooks/useDeckEditorLayer'
import { useDeckPreviewSession } from '@/hooks/useDeckPreviewSession'
import { useManualEditCommits } from '@/hooks/useManualEditCommits'
import { analyzeDeckInBrowser } from '@/lib/deck/deck-analysis'
import type { DeckPreviewHandle } from '@/lib/deck/deck-preview-handle'
import { resolveAppOrigin } from '@ark/runtime-registry/sandbox-origin.ts'
import { useDeckStore } from '@/state/deck-store.ts'

export type { DeckTextEditCommit } from '@/lib/editor/deck-text-edit'
export type { DeckPreviewHandle } from '@/lib/deck/deck-preview-handle'

type DeckPreviewProps = {
  layout: 'desktop' | 'mobile'
  chromeHost?: HTMLElement | null
  initialSlideIndex?: number
  editorBridgeEnabled?: boolean
  clearEditorSelectionRef?: MutableRefObject<(() => boolean) | null>
  presentHandleRef?: RefObject<DeckPreviewHandle | null>
  onToggleContextSlide?: (index: number) => void
}

export function DeckPreview({
  layout,
  chromeHost = null,
  initialSlideIndex = 0,
  editorBridgeEnabled = true,
  clearEditorSelectionRef,
  presentHandleRef,
  onToggleContextSlide,
}: DeckPreviewProps) {
  const html = useDeckStore((state) => state.html)
  const deckId = useDeckStore((state) => state.deckId)
  const analysis = useMemo(
    () => analyzeDeckInBrowser(html, { assetOrigin: resolveAppOrigin(), deckId }),
    [deckId, html],
  )
  const session = useDeckPreviewSession(analysis, { initialSlideIndex, presentHandleRef })
  const edits = useManualEditCommits()
  const imageInputRef = useRef<HTMLInputElement>(null)
  const editorBridgeActive = editorBridgeEnabled && session.chrome.editChromeActive
  const layer = useDeckEditorLayer({
    chrome: {
      bridgeEnabled: session.chrome.bridgeEnabled,
      editActive: session.chrome.editChromeActive,
      editorBridgeActive,
      editorBridgeEnabled,
    },
    frame: {
      iframeRef: session.frame.iframeRef,
      model: session.frame.previewFrame,
      scale: session.frame.previewFrameScale,
      viewportSize: session.frame.previewViewportSize,
    },
    navigation: {
      activeSlideIndex: session.navigation.activeSlideIndex,
      activeSlideIndexRef: session.refs.activeSlideIndexRef,
      goToSlide: session.navigation.goToSlide,
    },
    refs: {
      clearEditorSelectionRef,
      clearSelectionRef: session.refs.clearSelectionRef,
      textEditActiveRef: session.refs.textEditActiveRef,
    },
    session: session.session,
    source: {
      beginLivePatch: session.source.beginLivePatch,
      contentRevision: session.source.previewContentRevision,
      finishLivePatch: session.source.finishLivePatch,
      rollbackLivePatch: session.source.rollbackLivePatch,
    },
  })

  const handleReorderSlide = useCallback(
    async (fromIndex: number, toIndex: number) => {
      const result = await edits.handleReorderSlide(
        fromIndex,
        toIndex,
        session.navigation.activeSlideIndex,
      )
      const suggestedIndex = result?.patch.suggestedActiveSlideIndex
      if (typeof suggestedIndex === 'number') {
        session.navigation.goToSlide(suggestedIndex)
      }
      return result
    },
    [edits, session.navigation],
  )

  return (
    <DeckPreviewView
      analysis={analysis}
      chromeHost={chromeHost}
      editorBridgeEnabled={editorBridgeEnabled}
      handleReorderSlide={handleReorderSlide}
      hasDeck={html.length > 0 && analysis.slideCount > 0}
      imageInputRef={imageInputRef}
      layer={layer}
      layout={layout}
      onRestoreHistory={edits.handleRestoreDocumentHistory}
      onToggleContextSlide={onToggleContextSlide}
      session={session}
    />
  )
}
