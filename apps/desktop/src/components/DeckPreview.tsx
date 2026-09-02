import {
  useCallback,
  useMemo,
  useRef,
  type ChangeEvent,
  type MutableRefObject,
  type RefObject,
} from 'react'

import { DeckPreviewChrome } from '@/components/DeckPreviewChrome'
import { DeckEditorLayer } from '@/components/DeckEditorLayer'
import { useDeckEditorLayer } from '@/hooks/useDeckEditorLayer'
import { DeckPreviewStage } from '@/components/DeckPreviewStage'
import { DeckPreviewStrip } from '@/components/DeckPreviewStrip'
import { PresentMode } from '@/components/PresentMode'
import { useDeckPreviewSession } from '@/hooks/useDeckPreviewSession'
import { useManualEditCommits } from '@/hooks/useManualEditCommits'
import { analyzeDeckInBrowser } from '@/lib/deck/deck-analysis'
import type { DeckPreviewHandle } from '@/lib/deck/deck-preview-handle'
import { getSelectionSetBlockReason } from '@/lib/editor/editor-selection-set'
import { cn } from '@/lib/ui/utils'
import { resolveAppOrigin } from '@ark/runtime-registry/sandbox-origin.ts'
import { useDeckStore } from '@/state/deck-store.ts'
import { useEditorStore } from '@/state/editor-store.ts'

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
  const selectedTool = useEditorStore((state) => state.selectedTool)
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
  const mainPreviewReady =
    session.chrome.previewCompromised ||
    Boolean(session.frame.previewFrame.error) ||
    (session.session.armed &&
      !session.frame.previewFrame.isLoading &&
      !session.frame.previewFrame.isStale)
  const selection = layer.bridge.selection
  const overlaySelections = layer.bridge.selections ?? []
  const selectionSet =
    overlaySelections.length > 0 ? overlaySelections : selection ? [selection] : []
  const networkIssues = analysis.validation.issues.filter(
    (issue) => issue.code === 'external_url' && issue.severity === 'error',
  )

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
    <section className="flex h-full min-h-0 flex-col bg-[var(--ark-stage)]">
      <DeckPreviewChrome
        actions={{
          onBringForward: () => layer.coordinator.handleReorderSelection('front'),
          onDelete: layer.coordinator.handleDeleteSelection,
          onDuplicate: layer.coordinator.handleDuplicateSelection,
          onEditText: layer.beginTextEdit,
          onImageAltChange: layer.coordinator.handleImageAltChange,
          onImageFitChange: layer.coordinator.handleImageFitChange,
          onPickImage: () => imageInputRef.current?.click(),
          onRestoreHistory: edits.handleRestoreDocumentHistory,
          onSendBackward: () => layer.coordinator.handleReorderSelection('back'),
          onToolChange: layer.handleToolChange,
        }}
        chromeHost={chromeHost}
        editChromeActive={session.chrome.editChromeActive}
        editorBridgeEnabled={editorBridgeEnabled}
        fileInputRef={imageInputRef}
        imageAlt={layer.coordinator.selectedImageAlt}
        imageFit={layer.coordinator.selectedImageFit}
        onImageFileChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) {
            layer.handleToolChange('select')
            return
          }
          void layer.coordinator.handleInsertImageFile(file)
        }}
        toolbarState={{
          canEditText: layer.coordinator.canEditSelectedText,
          hasDeck: html.length > 0 && analysis.slideCount > 0,
          hasSelection: Boolean(selection?.elementId),
          selectedImage: layer.coordinator.selectedImage,
          selectionLocked: selection?.locked ?? false,
          selectionManaged: selection?.managed ?? false,
          selectionUnsafe: Boolean(
            getSelectionSetBlockReason(selectionSet) && selectionSet.length > 1,
          ),
        }}
      />
      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden',
          layout === 'desktop' ? 'flex flex-row' : 'flex flex-col',
        )}
      >
        <DeckPreviewStrip
          analysis={analysis}
          contentEnabled={mainPreviewReady}
          editChromeActive={session.chrome.editChromeActive}
          layout={layout}
          livePatchPending={session.source.livePatchPending}
          navigation={{
            activeIndex: session.navigation.activeSlideIndex,
            onSelect: session.navigation.goToSlide,
          }}
          onReorder={handleReorderSlide}
          onToggleContextSlide={onToggleContextSlide}
        />
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <DeckPreviewStage
            chrome={{
              editActive: session.chrome.editChromeActive,
              editorBridgeActive,
              presentOpen: session.chrome.isPresentOpen,
            }}
            editor={{
              activeTool: selectedTool,
              editorError: layer.bridge.editorError,
              enableEditor: layer.bridge.enableEditor,
              onClearSelection: layer.bridge.clearSelection,
              onInsertImageFile: (file, position) =>
                void layer.coordinator.handleInsertImageFile(file, position),
              overlay: (
                <DeckEditorLayer
                  editActive={session.chrome.editChromeActive}
                  editorBridgeEnabled={editorBridgeEnabled}
                  layer={layer}
                  scale={session.frame.previewFrameScale}
                />
              ),
              selection,
              textEditActive: layer.bridge.textEditActive,
            }}
            frame={{
              iframeRef: session.frame.iframeRef,
              model: session.frame.previewFrame,
              scale: session.frame.previewFrameScale,
              stageRef: session.frame.previewStageRef,
              viewportRef: session.frame.previewViewportRef,
            }}
            navigation={{
              activeSlideIndexRef: session.refs.activeSlideIndexRef,
              goToSlide: session.navigation.goToSlide,
            }}
            runtime={{
              mode: analysis.runtimeMode,
              networkIssue: networkIssues[0]?.message,
              onDismissRuntimeError: () => session.runtimeError.setNotice(null),
              runtimeError: session.runtimeError.notice,
              usesStaticPreview: analysis.usesStaticPreview,
            }}
            session={session.session}
          />
        </div>
      </div>
      {session.chrome.isPresentOpen ? (
        <PresentMode
          activeSlideIndex={session.navigation.activeSlideIndex}
          onExit={(finalIndex) => {
            session.present.pendingPresentExitIndexRef.current = finalIndex
            session.present.setIsPresentOpen(false)
          }}
          onGoToSlide={session.navigation.goToSlide}
          onViewportSizeChange={session.present.handlePresentViewportSizeChange}
          previewCompromised={session.chrome.previewCompromised}
          previewCompromiseReason={session.chrome.previewCompromiseReason}
          slideCount={analysis.slideCount}
        />
      ) : null}
    </section>
  )
}
