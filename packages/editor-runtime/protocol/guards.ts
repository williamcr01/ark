/** Runtime validation for editor bridge messages arriving over `postMessage`. */

import {
  EDITOR_ASSIGN_ID_MESSAGE_TYPE,
  EDITOR_BRIDGE_PROTOCOL_VERSION,
  EDITOR_CANCEL_TEXT_EDIT_MESSAGE_TYPE,
  EDITOR_CLEAR_SELECTION_MESSAGE_TYPE,
  EDITOR_CONFIGURE_MESSAGE_TYPE,
  EDITOR_CONNECT_ACK_MESSAGE_TYPE,
  EDITOR_CONNECT_MESSAGE_TYPE,
  EDITOR_DELETE_REQUEST_MESSAGE_TYPE,
  EDITOR_DISABLE_MESSAGE_TYPE,
  EDITOR_ENABLE_MESSAGE_TYPE,
  EDITOR_ERROR_MESSAGE_TYPE,
  EDITOR_GEOMETRY_MESSAGE_TYPE,
  EDITOR_HOVER_MESSAGE_TYPE,
  EDITOR_INSERT_REQUEST_MESSAGE_TYPE,
  EDITOR_MESSAGE_TYPE_SET,
  EDITOR_READY_MESSAGE_TYPE,
  EDITOR_REQUEST_GEOMETRY_MESSAGE_TYPE,
  EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
  EDITOR_SELECT_MESSAGE_TYPE,
  EDITOR_SET_TOOL_MESSAGE_TYPE,
  EDITOR_SHORTCUT_ACTION_SET,
  EDITOR_SHORTCUT_MESSAGE_TYPE,
  EDITOR_START_TEXT_EDIT_MESSAGE_TYPE,
  EDITOR_SURFACE_SET,
  EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
  EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
  EDITOR_TOOL_SET,
  EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE,
  EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
  EDITOR_TRANSFORM_END_MESSAGE_TYPE,
  EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
} from './message-types.ts'
import type { EditorMessageType } from './message-types.ts'
import {
  MAX_EDITOR_SELECTIONS,
  type EditorAdoptSpacer,
  type EditorAssignIdMessage,
  type EditorCancelTextEditMessage,
  type EditorClearSelectionMessage,
  type EditorConfigureMessage,
  type EditorConnectAckMessage,
  type EditorConnectMessage,
  type EditorDeleteRequestMessage,
  type EditorDisableMessage,
  type EditorEnableMessage,
  type EditorErrorMessage,
  type EditorGeometryMessage,
  type EditorHoverMessage,
  type EditorInsertRequestMessage,
  type EditorMessage,
  type EditorReadyMessage,
  type EditorRequestGeometryMessage,
  type EditorRuntimeMessage,
  type EditorSelectMessage,
  type EditorSelectionChangeMessage,
  type EditorSelectionImageSize,
  type EditorSelectionInfo,
  type EditorSelectionTextStyle,
  type EditorSetToolMessage,
  type EditorShellMessage,
  type EditorShortcutAction,
  type EditorShortcutMessage,
  type EditorStartTextEditMessage,
  type EditorSurface,
  type EditorTextCommitMessage,
  type EditorTextEditStateMessage,
  type EditorTool,
  type EditorTransformCancelMessage,
  type EditorTransformCommitMessage,
  type EditorTransformCompanion,
  type EditorTransformEndMessage,
  type EditorTransformPreviewMessage,
} from './types.ts'
import type { NormalizedRect as EditorNormalizedRect } from '@ark/deck/document/geometry.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNormalizedUnit(value: unknown) {
  return isFiniteNumber(value) && value >= 0 && value <= 1
}

export function isEditorConnectMessage(value: unknown): value is EditorConnectMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_CONNECT_MESSAGE_TYPE &&
    typeof value.handshake === 'string' &&
    value.handshake.length > 0 &&
    value.protocolVersion === EDITOR_BRIDGE_PROTOCOL_VERSION
  )
}

export function isEditorConnectAckMessage(value: unknown): value is EditorConnectAckMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_CONNECT_ACK_MESSAGE_TYPE &&
    value.protocolVersion === EDITOR_BRIDGE_PROTOCOL_VERSION
  )
}

export function isEditorMessageType(value: unknown): value is EditorMessageType {
  return typeof value === 'string' && EDITOR_MESSAGE_TYPE_SET.has(value)
}

export function isEditorTool(value: unknown): value is EditorTool {
  return typeof value === 'string' && EDITOR_TOOL_SET.has(value as EditorTool)
}

export function isEditorSurface(value: unknown): value is EditorSurface {
  return typeof value === 'string' && EDITOR_SURFACE_SET.has(value as EditorSurface)
}

export function isEditorShortcutAction(value: unknown): value is EditorShortcutAction {
  return typeof value === 'string' && EDITOR_SHORTCUT_ACTION_SET.has(value as EditorShortcutAction)
}

export function isEditorNormalizedRect(value: unknown): value is EditorNormalizedRect {
  if (!isRecord(value)) {
    return false
  }

  return (
    isNormalizedUnit(value.x) &&
    isNormalizedUnit(value.y) &&
    isNormalizedUnit(value.width) &&
    isNormalizedUnit(value.height)
  )
}

export function isEditorSelectionTextStyle(value: unknown): value is EditorSelectionTextStyle {
  if (!isRecord(value)) {
    return false
  }

  return (
    isFiniteNumber(value.fontSize) &&
    typeof value.fontWeight === 'string' &&
    typeof value.color === 'string' &&
    typeof value.textAlign === 'string' &&
    (value.lineHeight === null || isFiniteNumber(value.lineHeight))
  )
}

export function isEditorSelectionImageSize(value: unknown): value is EditorSelectionImageSize {
  if (!isRecord(value)) {
    return false
  }

  return isFiniteNumber(value.width) && isFiniteNumber(value.height)
}

export function isEditorSelectionInfo(value: unknown): value is EditorSelectionInfo {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.elementId === 'string' &&
    value.elementId.length > 0 &&
    isFiniteNumber(value.slideIndex) &&
    (value.slideId === null || typeof value.slideId === 'string') &&
    typeof value.tagName === 'string' &&
    typeof value.locked === 'boolean' &&
    typeof value.managed === 'boolean' &&
    (value.editableKind === null || typeof value.editableKind === 'string') &&
    (value.textPreview === null || typeof value.textPreview === 'string') &&
    (value.surface === undefined || isEditorSurface(value.surface)) &&
    (value.geometryEditable === undefined || typeof value.geometryEditable === 'boolean') &&
    (value.imageFit === undefined ||
      value.imageFit === null ||
      value.imageFit === 'contain' ||
      value.imageFit === 'cover' ||
      value.imageFit === 'fill') &&
    (value.role === undefined || value.role === null || typeof value.role === 'string') &&
    (value.textStyle === undefined ||
      value.textStyle === null ||
      isEditorSelectionTextStyle(value.textStyle)) &&
    (value.imageNaturalSize === undefined ||
      value.imageNaturalSize === null ||
      isEditorSelectionImageSize(value.imageNaturalSize)) &&
    (value.nestedInSelection === undefined || typeof value.nestedInSelection === 'boolean')
  )
}

function hasElementTarget(value: Record<string, unknown>) {
  return (
    typeof value.elementId === 'string' &&
    value.elementId.length > 0 &&
    isFiniteNumber(value.slideIndex)
  )
}

export function isEditorEnableMessage(value: unknown): value is EditorEnableMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_ENABLE_MESSAGE_TYPE &&
    isFiniteNumber(value.slideIndex) &&
    (value.tool === undefined || isEditorTool(value.tool)) &&
    (value.scale === undefined || (isFiniteNumber(value.scale) && value.scale > 0))
  )
}

export function isEditorConfigureMessage(value: unknown): value is EditorConfigureMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_CONFIGURE_MESSAGE_TYPE &&
    isFiniteNumber(value.scale) &&
    value.scale > 0
  )
}

export function isEditorDisableMessage(value: unknown): value is EditorDisableMessage {
  return isRecord(value) && value.type === EDITOR_DISABLE_MESSAGE_TYPE
}

export function isEditorSelectMessage(value: unknown): value is EditorSelectMessage {
  return isRecord(value) && value.type === EDITOR_SELECT_MESSAGE_TYPE && hasElementTarget(value)
}

export function isEditorClearSelectionMessage(
  value: unknown,
): value is EditorClearSelectionMessage {
  return isRecord(value) && value.type === EDITOR_CLEAR_SELECTION_MESSAGE_TYPE
}

export function isEditorStartTextEditMessage(value: unknown): value is EditorStartTextEditMessage {
  return (
    isRecord(value) && value.type === EDITOR_START_TEXT_EDIT_MESSAGE_TYPE && hasElementTarget(value)
  )
}

export function isEditorCancelTextEditMessage(
  value: unknown,
): value is EditorCancelTextEditMessage {
  return isRecord(value) && value.type === EDITOR_CANCEL_TEXT_EDIT_MESSAGE_TYPE
}

export function isEditorRequestGeometryMessage(
  value: unknown,
): value is EditorRequestGeometryMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_REQUEST_GEOMETRY_MESSAGE_TYPE &&
    hasElementTarget(value)
  )
}

export function isEditorSetToolMessage(value: unknown): value is EditorSetToolMessage {
  return isRecord(value) && value.type === EDITOR_SET_TOOL_MESSAGE_TYPE && isEditorTool(value.tool)
}

export function isEditorReadyMessage(value: unknown): value is EditorReadyMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_READY_MESSAGE_TYPE &&
    isFiniteNumber(value.slideIndex) &&
    value.protocolVersion === EDITOR_BRIDGE_PROTOCOL_VERSION
  )
}

export function isEditorHoverMessage(value: unknown): value is EditorHoverMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_HOVER_MESSAGE_TYPE &&
    isFiniteNumber(value.slideIndex) &&
    (value.elementId === null ||
      (typeof value.elementId === 'string' && value.elementId.length > 0)) &&
    (value.geometry === undefined || isEditorNormalizedRect(value.geometry)) &&
    (value.slideBounds === undefined || isEditorNormalizedRect(value.slideBounds)) &&
    (value.surface === undefined || isEditorSurface(value.surface))
  )
}

export function isEditorShortcutMessage(value: unknown): value is EditorShortcutMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_SHORTCUT_MESSAGE_TYPE &&
    isEditorShortcutAction(value.action)
  )
}

export function isEditorSelectionInfoList(value: unknown): value is EditorSelectionInfo[] {
  if (!Array.isArray(value) || value.length > MAX_EDITOR_SELECTIONS) {
    return false
  }

  const ids = new Set<string>()
  let slideIndex: number | undefined

  for (const item of value) {
    if (!isEditorSelectionInfo(item) || ids.has(item.elementId)) {
      return false
    }

    ids.add(item.elementId)

    if (slideIndex === undefined) {
      slideIndex = item.slideIndex
    } else if (item.slideIndex !== slideIndex) {
      return false
    }
  }

  return true
}

export function resolveEditorSelectionSet(
  selection: EditorSelectionInfo | null,
  selections?: EditorSelectionInfo[],
): EditorSelectionInfo[] {
  if (selections && selections.length > 0) {
    return selections
  }

  return selection ? [selection] : []
}

export function isEditorSelectionChangeMessage(
  value: unknown,
): value is EditorSelectionChangeMessage {
  if (
    !isRecord(value) ||
    value.type !== EDITOR_SELECTION_CHANGE_MESSAGE_TYPE ||
    !(value.selection === null || isEditorSelectionInfo(value.selection))
  ) {
    return false
  }

  if (value.selections === undefined) {
    return true
  }

  if (!isEditorSelectionInfoList(value.selections)) {
    return false
  }

  const selection = value.selection

  if (selection === null) {
    return value.selections.length === 0
  }

  return (
    isEditorSelectionInfo(selection) &&
    value.selections.some((item) => item.elementId === selection.elementId)
  )
}

export function isEditorGeometryMessage(value: unknown): value is EditorGeometryMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_GEOMETRY_MESSAGE_TYPE &&
    hasElementTarget(value) &&
    isEditorNormalizedRect(value.geometry) &&
    (value.zIndex === null || isFiniteNumber(value.zIndex)) &&
    (value.slideBounds === undefined || isEditorNormalizedRect(value.slideBounds)) &&
    (value.surface === undefined || isEditorSurface(value.surface))
  )
}

export function isEditorTextCommitMessage(value: unknown): value is EditorTextCommitMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_TEXT_COMMIT_MESSAGE_TYPE &&
    hasElementTarget(value) &&
    (value.slideId === null || typeof value.slideId === 'string') &&
    typeof value.text === 'string' &&
    typeof value.originalText === 'string'
  )
}

export function isEditorTextEditStateMessage(value: unknown): value is EditorTextEditStateMessage {
  if (!isRecord(value) || value.type !== EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE) {
    return false
  }

  if (typeof value.active !== 'boolean') {
    return false
  }

  if (value.active) {
    return hasElementTarget(value)
  }

  return value.elementId === undefined && value.slideIndex === undefined
}

export function isEditorTransformPreviewMessage(
  value: unknown,
): value is EditorTransformPreviewMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE &&
    hasElementTarget(value) &&
    isEditorNormalizedRect(value.geometry) &&
    (value.zIndex === undefined || value.zIndex === null || isFiniteNumber(value.zIndex)) &&
    (value.slideBounds === undefined || isEditorNormalizedRect(value.slideBounds))
  )
}

function isEditorAdoptSpacer(value: unknown): value is EditorAdoptSpacer {
  return (
    isRecord(value) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0 &&
    isFiniteNumber(value.marginTop) &&
    value.marginTop >= 0 &&
    isFiniteNumber(value.marginRight) &&
    value.marginRight >= 0 &&
    isFiniteNumber(value.marginBottom) &&
    value.marginBottom >= 0 &&
    isFiniteNumber(value.marginLeft) &&
    value.marginLeft >= 0 &&
    typeof value.display === 'string' &&
    value.display.trim().length > 0 &&
    value.display.length <= 64
  )
}

function isEditorTransformCommitFields(value: Record<string, unknown>): boolean {
  return (
    hasElementTarget(value) &&
    isEditorNormalizedRect(value.geometry) &&
    (value.zIndex === undefined || value.zIndex === null || isFiniteNumber(value.zIndex)) &&
    (value.slideBounds === undefined || isEditorNormalizedRect(value.slideBounds)) &&
    (value.adopted === undefined || value.adopted === true) &&
    (value.cssX === undefined || (isFiniteNumber(value.cssX) && Math.abs(value.cssX) <= 10)) &&
    (value.cssY === undefined || (isFiniteNumber(value.cssY) && Math.abs(value.cssY) <= 10)) &&
    (value.cssWidth === undefined || isFiniteNumber(value.cssWidth)) &&
    (value.cssHeight === undefined || isFiniteNumber(value.cssHeight)) &&
    (value.slideWidth === undefined ||
      (isFiniteNumber(value.slideWidth) && value.slideWidth > 0)) &&
    (value.slideHeight === undefined ||
      (isFiniteNumber(value.slideHeight) && value.slideHeight > 0)) &&
    (value.spacer === undefined || isEditorAdoptSpacer(value.spacer))
  )
}

export function isEditorTransformCompanion(value: unknown): value is EditorTransformCompanion {
  return isRecord(value) && value.type === undefined && isEditorTransformCommitFields(value)
}

export function isEditorTransformCommitMessage(
  value: unknown,
): value is EditorTransformCommitMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE &&
    isEditorTransformCommitFields(value) &&
    (value.companions === undefined ||
      (Array.isArray(value.companions) &&
        value.companions.length <= MAX_EDITOR_SELECTIONS - 1 &&
        value.companions.every(isEditorTransformCompanion)))
  )
}

export function isEditorTransformCancelMessage(
  value: unknown,
): value is EditorTransformCancelMessage {
  return isRecord(value) && value.type === EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE
}

export function isEditorTransformEndMessage(value: unknown): value is EditorTransformEndMessage {
  return isRecord(value) && value.type === EDITOR_TRANSFORM_END_MESSAGE_TYPE
}

export function isEditorAssignIdMessage(value: unknown): value is EditorAssignIdMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_ASSIGN_ID_MESSAGE_TYPE &&
    typeof value.fromElementId === 'string' &&
    value.fromElementId.trim().length > 0 &&
    typeof value.toElementId === 'string' &&
    value.toElementId.trim().length > 0 &&
    typeof value.slideIndex === 'number' &&
    Number.isFinite(value.slideIndex) &&
    (value.managed === undefined || typeof value.managed === 'boolean')
  )
}

export function isEditorDeleteRequestMessage(value: unknown): value is EditorDeleteRequestMessage {
  return (
    isRecord(value) && value.type === EDITOR_DELETE_REQUEST_MESSAGE_TYPE && hasElementTarget(value)
  )
}

export function isEditorInsertRequestMessage(value: unknown): value is EditorInsertRequestMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_INSERT_REQUEST_MESSAGE_TYPE &&
    value.kind === 'text-box' &&
    isFiniteNumber(value.slideIndex) &&
    isEditorNormalizedRect(value.geometry)
  )
}

export function isEditorErrorMessage(value: unknown): value is EditorErrorMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_ERROR_MESSAGE_TYPE &&
    typeof value.message === 'string' &&
    (value.code === undefined || typeof value.code === 'string')
  )
}

export function isEditorShellMessage(value: unknown): value is EditorShellMessage {
  return (
    isEditorEnableMessage(value) ||
    isEditorConfigureMessage(value) ||
    isEditorDisableMessage(value) ||
    isEditorSelectMessage(value) ||
    isEditorClearSelectionMessage(value) ||
    isEditorStartTextEditMessage(value) ||
    isEditorCancelTextEditMessage(value) ||
    isEditorRequestGeometryMessage(value) ||
    isEditorSetToolMessage(value) ||
    isEditorTransformCancelMessage(value) ||
    isEditorTransformEndMessage(value) ||
    isEditorAssignIdMessage(value)
  )
}

export function isEditorRuntimeMessage(value: unknown): value is EditorRuntimeMessage {
  return (
    isEditorReadyMessage(value) ||
    isEditorShortcutMessage(value) ||
    isEditorHoverMessage(value) ||
    isEditorSelectionChangeMessage(value) ||
    isEditorGeometryMessage(value) ||
    isEditorTextCommitMessage(value) ||
    isEditorTextEditStateMessage(value) ||
    isEditorTransformPreviewMessage(value) ||
    isEditorTransformCommitMessage(value) ||
    isEditorTransformCancelMessage(value) ||
    isEditorDeleteRequestMessage(value) ||
    isEditorInsertRequestMessage(value) ||
    isEditorErrorMessage(value)
  )
}

export function isEditorMessage(value: unknown): value is EditorMessage {
  return isEditorShellMessage(value) || isEditorRuntimeMessage(value)
}

export function parseEditorMessage(value: unknown): EditorMessage | null {
  return isEditorMessage(value) ? value : null
}
