import type { ChangeEvent, RefObject } from 'react'

import { DeckPreviewChrome } from '@/components/DeckPreviewChrome'
import { DeckEditorLayer } from '@/components/DeckEditorLayer'
import { DeckPreviewStage } from '@/components/DeckPreviewStage'
import { PresentMode } from '@/components/PresentMode'
import type { DeckEditorLayerModel } from '@/hooks/useDeckEditorLayer'
import { getSelectionSetBlockReason } from '@/lib/editor/editor-selection-set'
import type { DeckBrowserAnalysis } from '@/lib/deck/deck-analysis'
import { useEditorStore } from '@/state/editor-store.ts'

type DeckPreviewSessionModel = ReturnType<
  typeof import('@/hooks/useDeckPreviewSession').useDeckPreviewSession
>

export function DeckPreviewChromeBind({
  chromeHost,
  editorBridgeEnabled,
  hasDeck,
  imageInputRef,
  layer,
  onRestoreHistory,
  session,
}: {
  chromeHost?: HTMLElement | null
  editorBridgeEnabled: boolean
  hasDeck: boolean
  imageInputRef: RefObject<HTMLInputElement | null>
  layer: DeckEditorLayerModel
  onRestoreHistory?: (revision: number) => Promise<void>
  session: DeckPreviewSessionModel
}) {
  const selection = layer.bridge.selection
  const overlaySelections = layer.bridge.selections ?? []
  const selectionSet =
    overlaySelections.length > 0 ? overlaySelections : selection ? [selection] : []

  return (
    <DeckPreviewChrome
      actions={{
        onBringForward: () => layer.coordinator.handleReorderSelection('front'),
        onDelete: layer.coordinator.handleDeleteSelection,
        onDuplicate: layer.coordinator.handleDuplicateSelection,
        onEditText: layer.beginTextEdit,
        onImageAltChange: layer.coordinator.handleImageAltChange,
        onImageFitChange: layer.coordinator.handleImageFitChange,
        onPickImage: () => imageInputRef.current?.click(),
        onRestoreHistory,
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
        hasDeck,
        hasSelection: Boolean(selection?.elementId),
        selectedImage: layer.coordinator.selectedImage,
        selectionLocked: selection?.locked ?? false,
        selectionManaged: selection?.managed ?? false,
        selectionUnsafe: Boolean(
          getSelectionSetBlockReason(selectionSet) && selectionSet.length > 1,
        ),
      }}
    />
  )
}

export function DeckPreviewStageBind({
  analysis,
  editorBridgeEnabled,
  layer,
  session,
}: {
  analysis: DeckBrowserAnalysis
  editorBridgeEnabled: boolean
  layer: DeckEditorLayerModel
  session: DeckPreviewSessionModel
}) {
  const selectedTool = useEditorStore((state) => state.selectedTool)
  const editorBridgeActive = editorBridgeEnabled && session.chrome.editChromeActive
  const networkIssues = analysis.validation.issues.filter(
    (issue) => issue.code === 'external_url' && issue.severity === 'error',
  )

  return (
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
        selection: layer.bridge.selection,
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
  )
}

export function DeckPreviewPresentBind({
  analysis,
  session,
}: {
  analysis: DeckBrowserAnalysis
  session: DeckPreviewSessionModel
}) {
  if (!session.chrome.isPresentOpen) {
    return null
  }

  return (
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
  )
}
