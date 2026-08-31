/** Constructors for editor bridge messages, and the shell-side send helper. */

import {
  EDITOR_ASSIGN_ID_MESSAGE_TYPE,
  EDITOR_BRIDGE_PROTOCOL_VERSION,
  EDITOR_CANCEL_TEXT_EDIT_MESSAGE_TYPE,
  EDITOR_CLEAR_SELECTION_MESSAGE_TYPE,
  EDITOR_CONFIGURE_MESSAGE_TYPE,
  EDITOR_CONNECT_ACK_MESSAGE_TYPE,
  EDITOR_DELETE_REQUEST_MESSAGE_TYPE,
  EDITOR_DISABLE_MESSAGE_TYPE,
  EDITOR_ENABLE_MESSAGE_TYPE,
  EDITOR_ERROR_MESSAGE_TYPE,
  EDITOR_GEOMETRY_MESSAGE_TYPE,
  EDITOR_HOVER_MESSAGE_TYPE,
  EDITOR_INSERT_REQUEST_MESSAGE_TYPE,
  EDITOR_READY_MESSAGE_TYPE,
  EDITOR_REQUEST_GEOMETRY_MESSAGE_TYPE,
  EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
  EDITOR_SELECT_MESSAGE_TYPE,
  EDITOR_SET_TOOL_MESSAGE_TYPE,
  EDITOR_SHORTCUT_MESSAGE_TYPE,
  EDITOR_START_TEXT_EDIT_MESSAGE_TYPE,
  EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
  EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
  EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE,
  EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
  EDITOR_TRANSFORM_END_MESSAGE_TYPE,
  EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
} from './message-types.ts'
import type {
  EditorAdoptSpacer,
  EditorAssignIdMessage,
  EditorCancelTextEditMessage,
  EditorClearSelectionMessage,
  EditorConfigureMessage,
  EditorConnectAckMessage,
  EditorDeleteRequestMessage,
  EditorDisableMessage,
  EditorEnableMessage,
  EditorErrorMessage,
  EditorGeometryMessage,
  EditorHoverMessage,
  EditorInsertKind,
  EditorInsertRequestMessage,
  EditorReadyMessage,
  EditorRequestGeometryMessage,
  EditorSelectMessage,
  EditorSelectionChangeMessage,
  EditorSelectionInfo,
  EditorSetToolMessage,
  EditorShellMessage,
  EditorShortcutAction,
  EditorShortcutMessage,
  EditorStartTextEditMessage,
  EditorSurface,
  EditorTextCommitMessage,
  EditorTextEditStateMessage,
  EditorTool,
  EditorTransformCancelMessage,
  EditorTransformCommitMessage,
  EditorTransformEndMessage,
  EditorTransformPreviewMessage,
} from './types.ts'
import { DECK_BRIDGE_POST_MESSAGE_TARGET } from '@ark/runtime-registry/sandbox-origin.ts'
import type { NormalizedRect as EditorNormalizedRect } from '@ark/deck/document/geometry.ts'

export function createEditorEnableMessage(
  slideIndex: number,
  tool: EditorTool = 'select',
  scale?: number,
): EditorEnableMessage {
  return {
    type: EDITOR_ENABLE_MESSAGE_TYPE,
    slideIndex,
    tool,
    ...(scale !== undefined ? { scale } : {}),
  }
}

export function createEditorConfigureMessage(scale: number): EditorConfigureMessage {
  return { type: EDITOR_CONFIGURE_MESSAGE_TYPE, scale }
}

export function createEditorDisableMessage(): EditorDisableMessage {
  return { type: EDITOR_DISABLE_MESSAGE_TYPE }
}

export function createEditorSelectMessage(
  elementId: string,
  slideIndex: number,
): EditorSelectMessage {
  return { type: EDITOR_SELECT_MESSAGE_TYPE, elementId, slideIndex }
}

export function createEditorClearSelectionMessage(): EditorClearSelectionMessage {
  return { type: EDITOR_CLEAR_SELECTION_MESSAGE_TYPE }
}

export function createEditorStartTextEditMessage(
  elementId: string,
  slideIndex: number,
): EditorStartTextEditMessage {
  return { type: EDITOR_START_TEXT_EDIT_MESSAGE_TYPE, elementId, slideIndex }
}

export function createEditorCancelTextEditMessage(): EditorCancelTextEditMessage {
  return { type: EDITOR_CANCEL_TEXT_EDIT_MESSAGE_TYPE }
}

export function createEditorRequestGeometryMessage(
  elementId: string,
  slideIndex: number,
): EditorRequestGeometryMessage {
  return { type: EDITOR_REQUEST_GEOMETRY_MESSAGE_TYPE, elementId, slideIndex }
}

export function createEditorSetToolMessage(tool: EditorTool): EditorSetToolMessage {
  return { type: EDITOR_SET_TOOL_MESSAGE_TYPE, tool }
}

export function createEditorReadyMessage(slideIndex: number): EditorReadyMessage {
  return {
    type: EDITOR_READY_MESSAGE_TYPE,
    slideIndex,
    protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
  }
}

export function createEditorHoverMessage(
  slideIndex: number,
  elementId: string | null,
  geometry?: EditorNormalizedRect,
  slideBounds?: EditorNormalizedRect,
  surface?: EditorSurface,
): EditorHoverMessage {
  return {
    type: EDITOR_HOVER_MESSAGE_TYPE,
    slideIndex,
    elementId,
    ...(geometry ? { geometry } : {}),
    ...(slideBounds ? { slideBounds } : {}),
    ...(surface ? { surface } : {}),
  }
}

export function createEditorShortcutMessage(action: EditorShortcutAction): EditorShortcutMessage {
  return { type: EDITOR_SHORTCUT_MESSAGE_TYPE, action }
}

export function createEditorSelectionChangeMessage(
  selection: EditorSelectionInfo | null,
  selections?: EditorSelectionInfo[],
): EditorSelectionChangeMessage {
  if (!selection || !selections || selections.length === 0) {
    return { type: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE, selection }
  }

  return { type: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE, selection, selections }
}

export function createEditorGeometryMessage(
  elementId: string,
  slideIndex: number,
  geometry: EditorNormalizedRect,
  zIndex: number | null = null,
  slideBounds?: EditorNormalizedRect,
  surface?: EditorSurface,
): EditorGeometryMessage {
  return {
    type: EDITOR_GEOMETRY_MESSAGE_TYPE,
    elementId,
    slideIndex,
    geometry,
    zIndex,
    ...(slideBounds ? { slideBounds } : {}),
    ...(surface ? { surface } : {}),
  }
}

export function createEditorTextCommitMessage(
  elementId: string,
  slideIndex: number,
  text: string,
  originalText: string,
  slideId: string | null = null,
): EditorTextCommitMessage {
  return {
    type: EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
    elementId,
    slideIndex,
    slideId,
    text,
    originalText,
  }
}

export function createEditorTextEditStateMessage(
  active: boolean,
  elementId?: string,
  slideIndex?: number,
): EditorTextEditStateMessage {
  if (active) {
    return {
      type: EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
      active: true,
      elementId: elementId ?? '',
      slideIndex: slideIndex ?? 0,
    }
  }

  return { type: EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE, active: false }
}

export function createEditorTransformPreviewMessage(
  elementId: string,
  slideIndex: number,
  geometry: EditorNormalizedRect,
  zIndex?: number | null,
  slideBounds?: EditorNormalizedRect,
): EditorTransformPreviewMessage {
  return {
    type: EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
    elementId,
    slideIndex,
    geometry,
    ...(zIndex !== undefined ? { zIndex } : {}),
    ...(slideBounds ? { slideBounds } : {}),
  }
}

export function createEditorTransformCommitMessage(
  elementId: string,
  slideIndex: number,
  geometry: EditorNormalizedRect,
  zIndex?: number | null,
  slideBounds?: EditorNormalizedRect,
  adopted?: true,
  cssX?: number,
  cssY?: number,
  cssWidth?: number,
  cssHeight?: number,
  slideWidth?: number,
  slideHeight?: number,
  spacer?: EditorAdoptSpacer,
): EditorTransformCommitMessage {
  return {
    type: EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
    elementId,
    slideIndex,
    geometry,
    ...(zIndex !== undefined ? { zIndex } : {}),
    ...(slideBounds ? { slideBounds } : {}),
    ...(adopted ? { adopted } : {}),
    ...(cssX !== undefined ? { cssX } : {}),
    ...(cssY !== undefined ? { cssY } : {}),
    ...(cssWidth !== undefined ? { cssWidth } : {}),
    ...(cssHeight !== undefined ? { cssHeight } : {}),
    ...(slideWidth !== undefined ? { slideWidth } : {}),
    ...(slideHeight !== undefined ? { slideHeight } : {}),
    ...(spacer ? { spacer } : {}),
  }
}

export function createEditorTransformCancelMessage(): EditorTransformCancelMessage {
  return { type: EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE }
}

export function createEditorTransformEndMessage(): EditorTransformEndMessage {
  return { type: EDITOR_TRANSFORM_END_MESSAGE_TYPE }
}

export function createEditorAssignIdMessage(
  fromElementId: string,
  toElementId: string,
  slideIndex: number,
  managed?: boolean,
): EditorAssignIdMessage {
  return {
    type: EDITOR_ASSIGN_ID_MESSAGE_TYPE,
    fromElementId,
    toElementId,
    slideIndex,
    ...(managed ? { managed: true } : {}),
  }
}

export function createEditorDeleteRequestMessage(
  elementId: string,
  slideIndex: number,
): EditorDeleteRequestMessage {
  return { type: EDITOR_DELETE_REQUEST_MESSAGE_TYPE, elementId, slideIndex }
}

export function createEditorInsertRequestMessage(
  kind: EditorInsertKind,
  slideIndex: number,
  geometry: EditorNormalizedRect,
): EditorInsertRequestMessage {
  return { type: EDITOR_INSERT_REQUEST_MESSAGE_TYPE, kind, slideIndex, geometry }
}

export function createEditorErrorMessage(message: string, code?: string): EditorErrorMessage {
  return {
    type: EDITOR_ERROR_MESSAGE_TYPE,
    message,
    ...(code ? { code } : {}),
  }
}

export function createEditorConnectAckMessage(): EditorConnectAckMessage {
  return {
    type: EDITOR_CONNECT_ACK_MESSAGE_TYPE,
    protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
  }
}

export function postEditorShellMessage(
  target: Window,
  message: EditorShellMessage,
  targetOrigin = DECK_BRIDGE_POST_MESSAGE_TARGET,
) {
  target.postMessage(message, targetOrigin)
}
