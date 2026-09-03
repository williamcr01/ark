import { useCallback } from 'react'

import {
  createEditorAssignIdMessage,
  createEditorCancelTextEditMessage,
  createEditorClearSelectionMessage,
  createEditorConfigureMessage,
  createEditorDisableMessage,
  createEditorEnableMessage,
  createEditorRequestGeometryMessage,
  createEditorSelectMessage,
  createEditorSetToolMessage,
  createEditorStartTextEditMessage,
  type EditorShellMessage,
  type EditorTool,
} from '@ark/editor-runtime'

export type EditorBridgeCommands = {
  enableEditor: (slideIndex?: number, tool?: EditorTool, scale?: number) => boolean
  configureEditor: (scale: number) => boolean
  disableEditor: () => boolean
  selectElement: (elementId: string, slideIndex?: number) => boolean
  clearSelection: () => boolean
  requestGeometry: (elementId: string, slideIndex?: number) => boolean
  startTextEdit: (elementId: string, slideIndex?: number) => boolean
  cancelTextEdit: () => boolean
  setTool: (tool: EditorTool) => boolean
  assignElementId: (
    fromElementId: string,
    toElementId: string,
    slideIndex: number,
    managed?: boolean,
  ) => boolean
}

export function useEditorBridgeCommands(
  postToFrame: (message: EditorShellMessage) => boolean,
  activeSlideIndex: number,
): EditorBridgeCommands {
  return {
    enableEditor: useCallback(
      (slideIndex = activeSlideIndex, tool: EditorTool = 'select', scale?: number) =>
        postToFrame(createEditorEnableMessage(slideIndex, tool, scale)),
      [activeSlideIndex, postToFrame],
    ),
    configureEditor: useCallback(
      (scale: number) => postToFrame(createEditorConfigureMessage(scale)),
      [postToFrame],
    ),
    disableEditor: useCallback(() => postToFrame(createEditorDisableMessage()), [postToFrame]),
    selectElement: useCallback(
      (elementId: string, slideIndex = activeSlideIndex) =>
        postToFrame(createEditorSelectMessage(elementId, slideIndex)),
      [activeSlideIndex, postToFrame],
    ),
    clearSelection: useCallback(
      () => postToFrame(createEditorClearSelectionMessage()),
      [postToFrame],
    ),
    requestGeometry: useCallback(
      (elementId: string, slideIndex = activeSlideIndex) =>
        postToFrame(createEditorRequestGeometryMessage(elementId, slideIndex)),
      [activeSlideIndex, postToFrame],
    ),
    startTextEdit: useCallback(
      (elementId: string, slideIndex = activeSlideIndex) =>
        postToFrame(createEditorStartTextEditMessage(elementId, slideIndex)),
      [activeSlideIndex, postToFrame],
    ),
    cancelTextEdit: useCallback(
      () => postToFrame(createEditorCancelTextEditMessage()),
      [postToFrame],
    ),
    setTool: useCallback(
      (tool: EditorTool) => postToFrame(createEditorSetToolMessage(tool)),
      [postToFrame],
    ),
    assignElementId: useCallback(
      (fromElementId: string, toElementId: string, slideIndex: number, managed?: boolean) =>
        postToFrame(createEditorAssignIdMessage(fromElementId, toElementId, slideIndex, managed)),
      [postToFrame],
    ),
  }
}
