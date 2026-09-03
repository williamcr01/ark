import type { MutableRefObject, RefObject } from 'react'

import { useDeckEditorLayerEffects } from '@/hooks/useDeckEditorLayerEffects'
import { useDeckEditorShellShortcuts } from '@/hooks/useDeckEditorShellShortcuts'
import type { EditorTool } from '@ark/editor-runtime'

import type { DeckEditorLayerProps, DeckEditorOverlayHandle } from './useDeckEditorLayer.ts'
import type { DeckEditorLayerBridgeSlice } from './useDeckEditorLayerEffects.ts'

export function useDeckEditorLayerChrome(args: {
  chrome: DeckEditorLayerProps['chrome']
  frame: DeckEditorLayerProps['frame']
  navigation: DeckEditorLayerProps['navigation']
  refs: DeckEditorLayerProps['refs']
  session: DeckEditorLayerProps['session']
  selectedTool: EditorTool
  selectionOverlayRef: RefObject<DeckEditorOverlayHandle | null>
  bridge: DeckEditorLayerBridgeSlice & { clearSelection: () => boolean }
  endTextEditing: () => void
  wasEditChromeActiveRef: MutableRefObject<boolean>
  isTextEditSaving: boolean
  canEditSelectedText: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onSelectTool: () => void
  onBeginTextEdit: () => void
  onInsertImage: (file: File) => void
}) {
  useDeckEditorLayerEffects({
    chrome: args.chrome,
    frame: args.frame,
    navigation: args.navigation,
    refs: args.refs,
    session: args.session,
    selectedTool: args.selectedTool,
    selectionOverlayRef: args.selectionOverlayRef,
    bridge: args.bridge,
    endTextEditing: args.endTextEditing,
    wasEditChromeActiveRef: args.wasEditChromeActiveRef,
  })

  useDeckEditorShellShortcuts({
    active: args.chrome.editActive,
    textEditActive: args.bridge.textEditActive,
    isTextEditSaving: args.isTextEditSaving,
    activeTool: args.selectedTool,
    canEditSelectedText: args.canEditSelectedText,
    canUndo: args.canUndo,
    canRedo: args.canRedo,
    onUndo: args.onUndo,
    onRedo: args.onRedo,
    onEndTextEditing: args.endTextEditing,
    onSelectTool: args.onSelectTool,
    onBeginTextEdit: args.onBeginTextEdit,
    onInsertImage: args.onInsertImage,
    onClearSelection: args.bridge.clearSelection,
  })
}
