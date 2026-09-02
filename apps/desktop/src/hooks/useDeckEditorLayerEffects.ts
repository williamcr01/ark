import { useEffect, useLayoutEffect, type MutableRefObject, type RefObject } from 'react'

import { useEditorStore } from '@/state/editor-store.ts'
import type { EditorTool, EditorTransformPreviewMessage } from '@ark/editor-runtime'

import type { DeckEditorLayerProps, DeckEditorOverlayHandle } from './useDeckEditorLayer.ts'

export type DeckEditorLayerBridgeSlice = {
  clearSelection: () => boolean
  configureEditor: (scale: number) => boolean
  disableEditor: () => boolean
  editorReady: boolean
  enableEditor: (slideIndex?: number, tool?: EditorTool, scale?: number) => boolean
  requestGeometry: (elementId: string, slideIndex?: number) => boolean
  selection: { elementId: string; slideIndex: number } | null
  selections: Array<{ elementId: string; slideIndex: number }>
  setTransformPreviewListener: (
    listener: ((preview: EditorTransformPreviewMessage | null) => void) | null,
  ) => void
  textEditActive: boolean
}

type LayerEffectsInput = {
  chrome: DeckEditorLayerProps['chrome']
  frame: DeckEditorLayerProps['frame']
  navigation: DeckEditorLayerProps['navigation']
  refs: DeckEditorLayerProps['refs']
  session: DeckEditorLayerProps['session']
  selectedTool: EditorTool
  selectionOverlayRef: RefObject<DeckEditorOverlayHandle | null>
  bridge: DeckEditorLayerBridgeSlice
  endTextEditing: () => void
  wasEditChromeActiveRef: MutableRefObject<boolean>
}

function useDeckEditorLayerPreviewSync(input: LayerEffectsInput) {
  const { chrome, frame, navigation, refs, session, selectedTool, bridge, endTextEditing } = input
  const {
    clearSelection,
    disableEditor,
    enableEditor,
    setTransformPreviewListener,
    textEditActive,
  } = bridge

  useLayoutEffect(() => {
    setTransformPreviewListener((preview) => {
      if (!preview) {
        input.selectionOverlayRef.current?.clearTransformPreview()
        return
      }
      input.selectionOverlayRef.current?.applyTransformPreview(
        preview.geometry,
        preview.slideBounds,
      )
    })
    return () => {
      setTransformPreviewListener(null)
    }
  }, [input.selectionOverlayRef, setTransformPreviewListener])

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
    const wasEditChromeActive = input.wasEditChromeActiveRef.current
    input.wasEditChromeActiveRef.current = chrome.editActive
    if (!wasEditChromeActive || chrome.editActive) {
      return
    }
    endTextEditing()
    disableEditor()
  }, [chrome.editActive, disableEditor, endTextEditing, input.wasEditChromeActiveRef])
}

function useDeckEditorLayerSelectionSync(input: LayerEffectsInput) {
  const { chrome, frame, navigation, refs, selectedTool, bridge } = input
  const { clearSelection, configureEditor, editorReady, enableEditor, requestGeometry, selection } =
    bridge
  const selections = bridge.selections ?? []
  const selectedElementId = selection?.elementId ?? null
  const selectedSlideIndex = selection?.slideIndex ?? null
  const selectedElementIds = (selections.length > 0 ? selections : selection ? [selection] : [])
    .map((item) => item.elementId)
    .join('\0')

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
}

export function useDeckEditorLayerEffects(input: LayerEffectsInput) {
  useDeckEditorLayerPreviewSync(input)
  useDeckEditorLayerSelectionSync(input)
}
