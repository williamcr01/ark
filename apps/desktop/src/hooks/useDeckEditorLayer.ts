import { useCallback, useRef, type MutableRefObject, type RefObject } from 'react'

import { useDeckEditorBridge } from '@/hooks/useDeckEditorBridge'
import { useDeckEditorPatchCoordinator } from '@/hooks/useDeckEditorPatchCoordinator'
import { useDeckEditorLayerChrome } from '@/hooks/useDeckEditorLayerChrome'
import { createDeckEditorCoordinatorInput } from '@/hooks/useDeckEditorLayerPatches'
import { useManualEditCommits } from '@/hooks/useManualEditCommits'
import type { DeckPreviewFrameModel } from '@/hooks/useDeckPreviewFrame'
import type { PreviewBridgeSessionResult } from '@/hooks/usePreviewBridgeSession'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import { useDeckStore } from '@/state/deck-store.ts'
import { useEditorStore } from '@/state/editor-store.ts'
import type { EditorNormalizedRect, EditorSelectionInfo, EditorTool } from '@ark/editor-runtime'

export type DeckEditorOverlayHandle = {
  applyTransformPreview: (
    geometry: EditorNormalizedRect,
    slideBounds?: EditorNormalizedRect | null,
  ) => void
  clearTransformPreview: () => void
}

export type DeckEditorCompanionGeometry = {
  elementId: string
  geometry: EditorNormalizedRect
  locked?: boolean
  slideBounds?: EditorNormalizedRect | null
  surface?: EditorSelectionInfo['surface']
}

function collectCompanionGeometries(
  selection: EditorSelectionInfo | null,
  selections: EditorSelectionInfo[],
  selectionGeometries: Record<
    string,
    { geometry: EditorNormalizedRect; slideBounds?: EditorNormalizedRect | null }
  >,
): DeckEditorCompanionGeometry[] {
  const selectionSet = selections.length > 0 ? selections : selection ? [selection] : []
  const companionGeometries: DeckEditorCompanionGeometry[] = []
  for (const item of selectionSet) {
    if (item.elementId === selection?.elementId) {
      continue
    }
    const box = selectionGeometries[item.elementId]
    if (!box) {
      continue
    }
    companionGeometries.push({
      elementId: item.elementId,
      geometry: box.geometry,
      slideBounds: box.slideBounds,
      locked: item.locked,
      surface: item.surface,
    })
  }
  return companionGeometries
}

export type DeckEditorLayerProps = {
  chrome: {
    bridgeEnabled: boolean
    editActive: boolean
    editorBridgeActive: boolean
    editorBridgeEnabled: boolean
  }
  frame: {
    iframeRef: RefObject<HTMLIFrameElement | null>
    model: DeckPreviewFrameModel
    scale: number
    viewportSize: { width: number; height: number }
  }
  navigation: {
    activeSlideIndex: number
    activeSlideIndexRef: MutableRefObject<number>
    goToSlide: (index: number) => void
  }
  refs: {
    clearEditorSelectionRef?: MutableRefObject<(() => boolean) | null>
    clearSelectionRef: MutableRefObject<(() => boolean) | null>
    textEditActiveRef: MutableRefObject<boolean>
  }
  session: PreviewBridgeSessionResult
  source: {
    beginLivePatch: (elementId: string) => boolean
    contentRevision: number
    finishLivePatch: (result: DeckPreviewPatchResult | undefined) => void
    rollbackLivePatch: () => void
  }
}

export function useDeckEditorLayer({
  chrome,
  frame,
  navigation,
  refs,
  session,
  source,
}: DeckEditorLayerProps) {
  const deckId = useDeckStore((state) => state.deckId)
  const isTextEditSaving = useDeckStore((state) => state.isPatching || state.isSaving)
  const selectedTool = useEditorStore((state) => state.selectedTool)
  const edits = useManualEditCommits()
  const wasEditChromeActiveRef = useRef(false)
  const selectionOverlayRef = useRef<DeckEditorOverlayHandle>(null)

  const handleBridgeSelectionChange = useCallback(
    (next: EditorSelectionInfo | null, nextSelections: EditorSelectionInfo[] = []) => {
      useEditorStore
        .getState()
        .select(chrome.editActive ? next : null, chrome.editActive ? nextSelections : [])
    },
    [chrome.editActive],
  )

  const bridge = useDeckEditorBridge(frame.iframeRef, {
    enabled: chrome.editorBridgeActive && chrome.bridgeEnabled,
    activeSlideIndex: navigation.activeSlideIndex,
    sandboxOrigin: frame.model.sandboxOrigin,
    iframeGenerationKey: frame.model.iframeKey,
    sessionHandshake: frame.model.handshake,
    canPostToFrame: session.canPostToFrame,
    shouldAcceptInbound: session.shouldAcceptInbound,
    onSelectionChange: handleBridgeSelectionChange,
  })

  const setTool = bridge.setTool
  const handleToolChange = useCallback(
    (tool: EditorTool) => {
      useEditorStore.getState().setSelectedTool(tool)
      setTool(tool)
    },
    [setTool],
  )

  const coordinator = useDeckEditorPatchCoordinator(
    createDeckEditorCoordinatorInput({
      activeSlideIndex: navigation.activeSlideIndex,
      beginLivePatch: source.beginLivePatch,
      contentRevision: source.contentRevision,
      deckId,
      editChromeActive: chrome.editActive,
      edits,
      finishLivePatch: source.finishLivePatch,
      goToSlide: navigation.goToSlide,
      handleToolChange,
      iframeKey: frame.model.iframeKey,
      isTextEditSaving,
      rollbackLivePatch: source.rollbackLivePatch,
      bridge,
    }),
  )

  const beginTextEdit = useCallback(() => {
    if (!bridge.selection || !coordinator.canEditSelectedText || bridge.textEditActive) {
      return
    }
    bridge.startTextEdit(bridge.selection.elementId, bridge.selection.slideIndex)
  }, [bridge, coordinator.canEditSelectedText])

  const endTextEditing = useCallback(() => {
    if (!bridge.textEditActive) {
      return
    }
    bridge.cancelTextEdit()
  }, [bridge])

  useDeckEditorLayerChrome({
    chrome,
    frame,
    navigation,
    refs,
    session,
    selectedTool,
    selectionOverlayRef,
    bridge,
    endTextEditing,
    wasEditChromeActiveRef,
    isTextEditSaving,
    canEditSelectedText: coordinator.canEditSelectedText,
    canUndo: edits.canUndo,
    canRedo: edits.canRedo,
    onUndo: coordinator.handleUndo,
    onRedo: coordinator.handleRedo,
    onSelectTool: () => handleToolChange('select'),
    onBeginTextEdit: beginTextEdit,
    onInsertImage: (file) => void coordinator.handleInsertImageFile(file),
  })

  return {
    beginTextEdit,
    bridge,
    companionGeometries: collectCompanionGeometries(
      bridge.selection,
      bridge.selections ?? [],
      bridge.selectionGeometries ?? {},
    ),
    coordinator,
    handleToolChange,
    selectionOverlayRef,
  }
}

export type DeckEditorLayerModel = ReturnType<typeof useDeckEditorLayer>
