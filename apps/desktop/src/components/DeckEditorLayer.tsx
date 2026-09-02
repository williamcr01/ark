import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react'

import {
  EditorSelectionOverlay,
  type EditorOverlayCompanion,
  type EditorSelectionOverlayHandle,
} from '@/components/EditorSelectionOverlay'
import { SelectionInspectorChrome } from '@/components/SelectionInspectorChrome'
import { useDeckEditorBridge } from '@/hooks/useDeckEditorBridge'
import { useDeckEditorPatchCoordinator } from '@/hooks/useDeckEditorPatchCoordinator'
import { useDeckEditorShellShortcuts } from '@/hooks/useDeckEditorShellShortcuts'
import { useManualEditCommits } from '@/hooks/useManualEditCommits'
import type { DeckPreviewFrameModel } from '@/hooks/useDeckPreviewFrame'
import type { PreviewBridgeSessionResult } from '@/hooks/usePreviewBridgeSession'
import type { DeckPreviewPatchResult } from '@/hooks/useDeckPreviewSource'
import { useDeckStore } from '@/state/deck-store.ts'
import { useEditorStore } from '@/state/editor-store.ts'
import type { EditorSelectionInfo, EditorTool } from '@ark/editor-runtime'

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
  const selectionOverlayRef = useRef<EditorSelectionOverlayHandle>(null)

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

  const {
    enableEditor,
    setTool,
    clearSelection,
    setTransformPreviewListener,
    disableEditor,
    startTextEdit,
    cancelTextEdit,
    configureEditor,
    requestGeometry,
    editorReady,
    selection,
    selections = [],
    textEditActive,
    selectionGeometries = {},
  } = bridge

  const handleToolChange = useCallback(
    (tool: EditorTool) => {
      useEditorStore.getState().setSelectedTool(tool)
      setTool(tool)
    },
    [setTool],
  )

  const coordinator = useDeckEditorPatchCoordinator({
    activeSlideIndex: navigation.activeSlideIndex,
    canRedo: edits.canRedo,
    canUndo: edits.canUndo,
    editChromeActive: chrome.editActive,
    editorReady,
    geometry: bridge.geometry,
    iframeKey: frame.model.iframeKey,
    isTextEditSaving,
    lastDeleteRequest: bridge.lastDeleteRequest,
    lastInsertRequest: bridge.lastInsertRequest,
    lastShortcutRequest: bridge.lastShortcutRequest,
    lastTextCommit: bridge.lastTextCommit,
    onCommitTextEdit: edits.handleCommitTextEdit,
    onPatchEditorOperations: edits.handlePatchEditorOperations,
    onRedo: edits.handleRedoEdit,
    onSelectElement: bridge.selectElement,
    onSelectTool: handleToolChange,
    onUndo: edits.handleUndoEdit,
    preserveRedoSlideIndex: edits.redoSlideIndex,
    preserveUndoSlideIndex: edits.undoSlideIndex,
    previewContentRevision: source.contentRevision,
    selection,
    selections,
    scopeKey: deckId,
    textEditActive,
    transformCancelSequence: bridge.transformCancelSequence,
    transformCommit: bridge.transformCommit,
    transformPreview: bridge.transformPreview,
    beginLivePatch: source.beginLivePatch,
    finishLivePatch: source.finishLivePatch,
    goToSlide: navigation.goToSlide,
    rollbackLivePatch: source.rollbackLivePatch,
    onAssignElementId: bridge.assignElementId,
  })

  const beginTextEdit = useCallback(() => {
    if (!selection || !coordinator.canEditSelectedText || textEditActive) {
      return
    }
    startTextEdit(selection.elementId, selection.slideIndex)
  }, [coordinator.canEditSelectedText, selection, startTextEdit, textEditActive])

  const endTextEditing = useCallback(() => {
    if (!textEditActive) {
      return
    }
    cancelTextEdit()
  }, [cancelTextEdit, textEditActive])

  useLayoutEffect(() => {
    setTransformPreviewListener((preview) => {
      if (!preview) {
        selectionOverlayRef.current?.clearTransformPreview()
        return
      }
      selectionOverlayRef.current?.applyTransformPreview(preview.geometry, preview.slideBounds)
    })
    return () => {
      setTransformPreviewListener(null)
    }
  }, [setTransformPreviewListener])

  useLayoutEffect(() => {
    refs.clearSelectionRef.current = clearSelection
  }, [clearSelection, refs.clearSelectionRef])

  useEffect(() => {
    refs.textEditActiveRef.current = textEditActive
    useEditorStore.getState().setTextEditActive(textEditActive)
  }, [refs.textEditActiveRef, textEditActive])

  useEffect(() => {
    if (!session.armed || session.compromised) {
      return
    }
    navigation.goToSlide(navigation.activeSlideIndexRef.current)
    if (chrome.editorBridgeActive) {
      enableEditor(navigation.activeSlideIndexRef.current, selectedTool, frame.scale || undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tool/scale are initial enable payloads; their dedicated messages own later updates
  }, [
    chrome.editorBridgeActive,
    enableEditor,
    frame.model.iframeKey,
    navigation.goToSlide,
    session.armed,
    session.compromised,
  ])

  useEffect(() => {
    const wasEditChromeActive = wasEditChromeActiveRef.current
    wasEditChromeActiveRef.current = chrome.editActive
    if (!wasEditChromeActive || chrome.editActive) {
      return
    }
    endTextEditing()
    disableEditor()
  }, [chrome.editActive, disableEditor, endTextEditing])

  useDeckEditorShellShortcuts({
    active: chrome.editActive,
    textEditActive,
    isTextEditSaving,
    activeTool: selectedTool,
    canEditSelectedText: coordinator.canEditSelectedText,
    canUndo: edits.canUndo,
    canRedo: edits.canRedo,
    onUndo: coordinator.handleUndo,
    onRedo: coordinator.handleRedo,
    onEndTextEditing: endTextEditing,
    onSelectTool: () => handleToolChange('select'),
    onBeginTextEdit: beginTextEdit,
    onInsertImage: (file) => void coordinator.handleInsertImageFile(file),
    onClearSelection: clearSelection,
  })

  useEffect(() => {
    if (!chrome.editorBridgeActive || !editorReady) {
      return
    }
    enableEditor(navigation.activeSlideIndex, selectedTool, frame.scale || undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tool/scale are initial enable payloads; their dedicated messages own later updates
  }, [
    chrome.editorBridgeActive,
    editorReady,
    enableEditor,
    frame.model.iframeKey,
    navigation.activeSlideIndex,
  ])

  useEffect(() => {
    if (chrome.editorBridgeActive && editorReady && frame.scale > 0) {
      configureEditor(frame.scale)
    }
  }, [chrome.editorBridgeActive, configureEditor, editorReady, frame.scale])

  const selectedElementId = selection?.elementId ?? null
  const selectedSlideIndex = selection?.slideIndex ?? null
  const selectedElementIds = (selections.length > 0 ? selections : selection ? [selection] : [])
    .map((item) => item.elementId)
    .join('\0')

  useEffect(() => {
    if (!chrome.editActive || selectedElementId === null || selectedSlideIndex === null) {
      return
    }
    const targets =
      selections.length > 0
        ? selections
        : [{ elementId: selectedElementId, slideIndex: selectedSlideIndex }]
    for (const target of targets) {
      requestGeometry(target.elementId, target.slideIndex)
    }
  }, [
    chrome.editActive,
    frame.viewportSize.height,
    frame.viewportSize.width,
    requestGeometry,
    selectedElementId,
    selectedElementIds,
    selectedSlideIndex,
    selections,
  ])

  useEffect(() => {
    if (!refs.clearEditorSelectionRef) {
      return
    }
    if (chrome.editorBridgeActive && chrome.bridgeEnabled) {
      refs.clearEditorSelectionRef.current = clearSelection
    } else {
      refs.clearEditorSelectionRef.current = null
    }
    return () => {
      if (refs.clearEditorSelectionRef) {
        refs.clearEditorSelectionRef.current = null
      }
    }
  }, [
    chrome.bridgeEnabled,
    chrome.editorBridgeActive,
    clearSelection,
    refs.clearEditorSelectionRef,
  ])

  const selectionSet = selections.length > 0 ? selections : selection ? [selection] : []
  const companionGeometries: EditorOverlayCompanion[] = []
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

  return {
    beginTextEdit,
    bridge,
    companionGeometries,
    coordinator,
    handleToolChange,
    overlay: chrome.editActive ? (
      <>
        <EditorSelectionOverlay
          companionGeometries={companionGeometries}
          geometry={selection ? bridge.geometry : null}
          hoverGeometry={
            bridge.hover?.elementId === selection?.elementId ? null : bridge.hoverGeometry
          }
          hoverSlideBounds={bridge.hoverSlideBounds}
          hoverSurface={bridge.hover?.surface}
          isEditing={textEditActive}
          locked={selection?.locked ?? false}
          ref={selectionOverlayRef}
          scale={frame.scale}
          slideBounds={bridge.slideBounds}
          surface={selection?.surface}
        />
        {chrome.editorBridgeEnabled ? (
          <SelectionInspectorChrome
            geometry={bridge.geometry}
            isSaving={isTextEditSaving}
            onApplyOperations={coordinator.handleInspectorApply}
            scale={frame.scale}
            selection={selection}
            slideBounds={bridge.slideBounds}
            textEditActive={textEditActive}
            transforming={Boolean(bridge.transformPreview)}
            zIndex={bridge.selectionZIndex}
          />
        ) : null}
      </>
    ) : null,
  }
}

export function DeckEditorLayer(props: DeckEditorLayerProps) {
  return useDeckEditorLayer(props).overlay
}
