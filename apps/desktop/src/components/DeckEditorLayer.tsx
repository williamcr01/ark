import type { RefObject } from 'react'

import {
  EditorSelectionOverlay,
  type EditorSelectionOverlayHandle,
} from '@/components/EditorSelectionOverlay'
import { SelectionInspectorChrome } from '@/components/SelectionInspectorChrome'
import type { DeckEditorLayerModel } from '@/hooks/useDeckEditorLayer'
import { useDeckStore } from '@/state/deck-store.ts'

type DeckEditorLayerViewProps = {
  editActive: boolean
  editorBridgeEnabled: boolean
  layer: DeckEditorLayerModel
  scale: number
}

export function DeckEditorLayer({
  editActive,
  editorBridgeEnabled,
  layer,
  scale,
}: DeckEditorLayerViewProps) {
  const isTextEditSaving = useDeckStore((state) => state.isPatching || state.isSaving)
  const { bridge, companionGeometries, coordinator, selectionOverlayRef } = layer
  const selection = bridge.selection

  if (!editActive) {
    return null
  }

  return (
    <>
      <EditorSelectionOverlay
        companionGeometries={companionGeometries}
        geometry={selection ? bridge.geometry : null}
        hoverGeometry={
          bridge.hover?.elementId === selection?.elementId ? null : bridge.hoverGeometry
        }
        hoverSlideBounds={bridge.hoverSlideBounds}
        hoverSurface={bridge.hover?.surface}
        isEditing={bridge.textEditActive}
        locked={selection?.locked ?? false}
        ref={selectionOverlayRef as RefObject<EditorSelectionOverlayHandle | null>}
        scale={scale}
        slideBounds={bridge.slideBounds}
        surface={selection?.surface}
      />
      {editorBridgeEnabled ? (
        <SelectionInspectorChrome
          geometry={bridge.geometry}
          isSaving={isTextEditSaving}
          onApplyOperations={coordinator.handleInspectorApply}
          scale={scale}
          selection={selection}
          slideBounds={bridge.slideBounds}
          textEditActive={bridge.textEditActive}
          transforming={Boolean(bridge.transformPreview)}
          zIndex={bridge.selectionZIndex}
        />
      ) : null}
    </>
  )
}
