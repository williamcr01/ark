/**
 * Ark manual editor bridge protocol (issue #75).
 *
 * The shell and sandboxed deck iframe coordinate selection and editing through
 * validated postMessage payloads. The injected runtime stays dormant until the
 * parent sends `ark:editor-enable`.
 *
 * @see docs/deck-editor-bridge.md
 */

import { INLINE_TEXT_EDITABLE_TAGS } from './deck-editable.ts'
import {
  ARK_TEXT_BOX_CLASS,
  ARK_TEXT_BOX_EDITABLE_VALUE,
  DEFAULT_TEXT_BOX_NORMALIZED_SIZE,
  MIN_TEXT_BOX_NORMALIZED_SIZE,
} from './deck-text-box.ts'
import {
  ARK_ELEMENT_ID_ATTR,
  ARK_LOCKED_ATTR,
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
  TRANSIENT_ELEMENT_ID_PREFIX,
} from './deck-metadata.ts'
import { DECK_BRIDGE_POST_MESSAGE_TARGET } from '@ark/runtime-registry/sandbox-origin.ts'

export const EDITOR_BRIDGE_PROTOCOL_VERSION = 1 as const

export const EDITOR_ENABLE_MESSAGE_TYPE = 'ark:editor-enable' as const
export const EDITOR_CONFIGURE_MESSAGE_TYPE = 'ark:editor-configure' as const
export const EDITOR_DISABLE_MESSAGE_TYPE = 'ark:editor-disable' as const
export const EDITOR_SELECT_MESSAGE_TYPE = 'ark:editor-select' as const
export const EDITOR_CLEAR_SELECTION_MESSAGE_TYPE = 'ark:editor-clear-selection' as const
export const EDITOR_START_TEXT_EDIT_MESSAGE_TYPE = 'ark:editor-start-text-edit' as const
export const EDITOR_CANCEL_TEXT_EDIT_MESSAGE_TYPE = 'ark:editor-cancel-text-edit' as const
export const EDITOR_REQUEST_GEOMETRY_MESSAGE_TYPE = 'ark:editor-request-geometry' as const
export const EDITOR_SET_TOOL_MESSAGE_TYPE = 'ark:editor-set-tool' as const

export const EDITOR_READY_MESSAGE_TYPE = 'ark:editor-ready' as const
export const EDITOR_SHORTCUT_MESSAGE_TYPE = 'ark:editor-shortcut' as const
export const EDITOR_HOVER_MESSAGE_TYPE = 'ark:editor-hover' as const
export const EDITOR_SELECTION_CHANGE_MESSAGE_TYPE = 'ark:editor-selection-change' as const
export const EDITOR_GEOMETRY_MESSAGE_TYPE = 'ark:editor-geometry' as const
export const EDITOR_TEXT_COMMIT_MESSAGE_TYPE = 'ark:editor-text-commit' as const
export const EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE = 'ark:editor-text-edit-state' as const
export const EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE = 'ark:editor-transform-preview' as const
export const EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE = 'ark:editor-transform-commit' as const
export const EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE = 'ark:editor-transform-cancel' as const
export const EDITOR_DELETE_REQUEST_MESSAGE_TYPE = 'ark:editor-delete-request' as const
export const EDITOR_INSERT_REQUEST_MESSAGE_TYPE = 'ark:editor-insert-request' as const
export const EDITOR_ERROR_MESSAGE_TYPE = 'ark:editor-error' as const

export const EDITOR_SHELL_MESSAGE_TYPES = [
  EDITOR_ENABLE_MESSAGE_TYPE,
  EDITOR_CONFIGURE_MESSAGE_TYPE,
  EDITOR_DISABLE_MESSAGE_TYPE,
  EDITOR_SELECT_MESSAGE_TYPE,
  EDITOR_CLEAR_SELECTION_MESSAGE_TYPE,
  EDITOR_START_TEXT_EDIT_MESSAGE_TYPE,
  EDITOR_CANCEL_TEXT_EDIT_MESSAGE_TYPE,
  EDITOR_REQUEST_GEOMETRY_MESSAGE_TYPE,
  EDITOR_SET_TOOL_MESSAGE_TYPE,
  EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE,
] as const

export const EDITOR_RUNTIME_MESSAGE_TYPES = [
  EDITOR_READY_MESSAGE_TYPE,
  EDITOR_SHORTCUT_MESSAGE_TYPE,
  EDITOR_HOVER_MESSAGE_TYPE,
  EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
  EDITOR_GEOMETRY_MESSAGE_TYPE,
  EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
  EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
  EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
  EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
  EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE,
  EDITOR_DELETE_REQUEST_MESSAGE_TYPE,
  EDITOR_INSERT_REQUEST_MESSAGE_TYPE,
  EDITOR_ERROR_MESSAGE_TYPE,
] as const

export const EDITOR_MESSAGE_TYPES = [
  ...EDITOR_SHELL_MESSAGE_TYPES,
  ...EDITOR_RUNTIME_MESSAGE_TYPES,
] as const

export type EditorShellMessageType = (typeof EDITOR_SHELL_MESSAGE_TYPES)[number]
export type EditorRuntimeMessageType = (typeof EDITOR_RUNTIME_MESSAGE_TYPES)[number]
export type EditorMessageType = (typeof EDITOR_MESSAGE_TYPES)[number]

export type EditorTool = 'select' | 'text' | 'insert'
export type EditorSurface = 'light' | 'dark'
export type EditorShortcutAction = 'undo' | 'redo' | 'duplicate'

export type EditorNormalizedRect = {
  x: number
  y: number
  width: number
  height: number
}

export type EditorImageFitMode = 'contain' | 'cover' | 'fill'

/** Computed text styling for the selected element (issue #84). */
export type EditorSelectionTextStyle = {
  /** Computed font size in pixels. */
  fontSize: number
  /** Computed font weight (numeric string, e.g. "400" or "700"). */
  fontWeight: string
  /** Computed text color (CSS color string, typically rgb()). */
  color: string
  /** Computed text alignment keyword. */
  textAlign: string
  /** Computed line height in pixels, or null when "normal". */
  lineHeight: number | null
}

export type EditorSelectionImageSize = {
  width: number
  height: number
}

export type EditorSelectionInfo = {
  elementId: string
  slideIndex: number
  slideId: string | null
  tagName: string
  locked: boolean
  managed: boolean
  editableKind: string | null
  textPreview: string | null
  imageFit?: EditorImageFitMode | null
  surface?: EditorSurface
  /** Inspector geometry is safe to persist without runtime coordinate conversion. */
  geometryEditable?: boolean
  /** Semantic role from data-ark-role, when present (issue #84). */
  role?: string | null
  /** Computed text styles for text-like selections (issue #84). */
  textStyle?: EditorSelectionTextStyle | null
  /** Intrinsic image dimensions for img selections (issue #84). */
  imageNaturalSize?: EditorSelectionImageSize | null
}

export type EditorEnableMessage = {
  type: typeof EDITOR_ENABLE_MESSAGE_TYPE
  slideIndex: number
  tool?: EditorTool
  scale?: number
}

export type EditorConfigureMessage = {
  type: typeof EDITOR_CONFIGURE_MESSAGE_TYPE
  scale: number
}

export type EditorDisableMessage = {
  type: typeof EDITOR_DISABLE_MESSAGE_TYPE
}

export type EditorSelectMessage = {
  type: typeof EDITOR_SELECT_MESSAGE_TYPE
  elementId: string
  slideIndex: number
}

export type EditorClearSelectionMessage = {
  type: typeof EDITOR_CLEAR_SELECTION_MESSAGE_TYPE
}

export type EditorStartTextEditMessage = {
  type: typeof EDITOR_START_TEXT_EDIT_MESSAGE_TYPE
  elementId: string
  slideIndex: number
}

export type EditorCancelTextEditMessage = {
  type: typeof EDITOR_CANCEL_TEXT_EDIT_MESSAGE_TYPE
}

export type EditorRequestGeometryMessage = {
  type: typeof EDITOR_REQUEST_GEOMETRY_MESSAGE_TYPE
  elementId: string
  slideIndex: number
}

export type EditorSetToolMessage = {
  type: typeof EDITOR_SET_TOOL_MESSAGE_TYPE
  tool: EditorTool
}

export type EditorReadyMessage = {
  type: typeof EDITOR_READY_MESSAGE_TYPE
  slideIndex: number
  protocolVersion: typeof EDITOR_BRIDGE_PROTOCOL_VERSION
}

export type EditorHoverMessage = {
  type: typeof EDITOR_HOVER_MESSAGE_TYPE
  elementId: string | null
  slideIndex: number
  geometry?: EditorNormalizedRect
  slideBounds?: EditorNormalizedRect
  surface?: EditorSurface
}

export type EditorSelectionChangeMessage = {
  type: typeof EDITOR_SELECTION_CHANGE_MESSAGE_TYPE
  selection: EditorSelectionInfo | null
}

export type EditorGeometryMessage = {
  type: typeof EDITOR_GEOMETRY_MESSAGE_TYPE
  elementId: string
  slideIndex: number
  geometry: EditorNormalizedRect
  zIndex: number | null
  /** Slide box normalized to the iframe viewport (for parent overlay mapping). */
  slideBounds?: EditorNormalizedRect
  surface?: EditorSurface
}

export type EditorTextCommitMessage = {
  type: typeof EDITOR_TEXT_COMMIT_MESSAGE_TYPE
  elementId: string
  slideIndex: number
  slideId: string | null
  text: string
  originalText: string
}

export type EditorTextEditStateMessage = {
  type: typeof EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE
  active: boolean
  elementId?: string
  slideIndex?: number
}

export type EditorTransformPreviewMessage = {
  type: typeof EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE
  elementId: string
  slideIndex: number
  geometry: EditorNormalizedRect
  zIndex?: number | null
  slideBounds?: EditorNormalizedRect
}

export type EditorTransformCommitMessage = {
  type: typeof EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE
  elementId: string
  slideIndex: number
  geometry: EditorNormalizedRect
  zIndex?: number | null
  slideBounds?: EditorNormalizedRect
  adopted?: true
  /** Persisted CSS left normalized by slide width; may be outside the slide. */
  cssX?: number
  /** Persisted CSS top normalized by slide height; may be outside the slide. */
  cssY?: number
  /** Adopted border-box width normalized by the slide's logical width. */
  cssWidth?: number
  /** Resized border-box height normalized by the slide's logical height. */
  cssHeight?: number
  /** Logical slide width used to convert normalized CSS values to pixels. */
  slideWidth?: number
  /** Logical slide height used to convert normalized CSS values to pixels. */
  slideHeight?: number
}

export type EditorTransformCancelMessage = {
  type: typeof EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE
}

export type EditorShortcutMessage = {
  type: typeof EDITOR_SHORTCUT_MESSAGE_TYPE
  action: EditorShortcutAction
}

export type EditorDeleteRequestMessage = {
  type: typeof EDITOR_DELETE_REQUEST_MESSAGE_TYPE
  elementId: string
  slideIndex: number
}

export type EditorInsertKind = 'text-box'

export type EditorInsertRequestMessage = {
  type: typeof EDITOR_INSERT_REQUEST_MESSAGE_TYPE
  kind: EditorInsertKind
  slideIndex: number
  geometry: EditorNormalizedRect
}

export type EditorErrorMessage = {
  type: typeof EDITOR_ERROR_MESSAGE_TYPE
  message: string
  code?: string
}

export type EditorShellMessage =
  | EditorEnableMessage
  | EditorConfigureMessage
  | EditorDisableMessage
  | EditorSelectMessage
  | EditorClearSelectionMessage
  | EditorStartTextEditMessage
  | EditorCancelTextEditMessage
  | EditorRequestGeometryMessage
  | EditorSetToolMessage
  | EditorTransformCancelMessage

export type EditorRuntimeMessage =
  | EditorReadyMessage
  | EditorShortcutMessage
  | EditorHoverMessage
  | EditorSelectionChangeMessage
  | EditorGeometryMessage
  | EditorTextCommitMessage
  | EditorTextEditStateMessage
  | EditorTransformPreviewMessage
  | EditorTransformCommitMessage
  | EditorTransformCancelMessage
  | EditorDeleteRequestMessage
  | EditorInsertRequestMessage
  | EditorErrorMessage

export type EditorMessage = EditorShellMessage | EditorRuntimeMessage

const EDITOR_MESSAGE_TYPE_SET = new Set<string>(EDITOR_MESSAGE_TYPES)
const EDITOR_TOOL_SET = new Set<EditorTool>(['select', 'text', 'insert'])
const EDITOR_SURFACE_SET = new Set<EditorSurface>(['light', 'dark'])
const EDITOR_SHORTCUT_ACTION_SET = new Set<EditorShortcutAction>(['undo', 'redo', 'duplicate'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNormalizedUnit(value: unknown) {
  return isFiniteNumber(value) && value >= 0 && value <= 1
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
      isEditorSelectionImageSize(value.imageNaturalSize))
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

export function isEditorSelectionChangeMessage(
  value: unknown,
): value is EditorSelectionChangeMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_SELECTION_CHANGE_MESSAGE_TYPE &&
    (value.selection === null || isEditorSelectionInfo(value.selection))
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

export function isEditorTransformCommitMessage(
  value: unknown,
): value is EditorTransformCommitMessage {
  return (
    isRecord(value) &&
    value.type === EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE &&
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
      (isFiniteNumber(value.slideHeight) && value.slideHeight > 0))
  )
}

export function isEditorTransformCancelMessage(
  value: unknown,
): value is EditorTransformCancelMessage {
  return isRecord(value) && value.type === EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE
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
    isEditorTransformCancelMessage(value)
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
): EditorSelectionChangeMessage {
  return { type: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE, selection }
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
  }
}

export function createEditorTransformCancelMessage(): EditorTransformCancelMessage {
  return { type: EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE }
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

export function postEditorShellMessage(
  target: Window,
  message: EditorShellMessage,
  targetOrigin = DECK_BRIDGE_POST_MESSAGE_TARGET,
) {
  target.postMessage(message, targetOrigin)
}

export type DeckEditorBridgeRuntimeScriptOptions = {
  slideSelectors: readonly string[]
  parentOrigin?: string
}

export function buildDeckEditorBridgeRuntimeScript(
  options: DeckEditorBridgeRuntimeScriptOptions,
): string {
  const constants = {
    PROTOCOL_VERSION: EDITOR_BRIDGE_PROTOCOL_VERSION,
    ENABLE: EDITOR_ENABLE_MESSAGE_TYPE,
    CONFIGURE: EDITOR_CONFIGURE_MESSAGE_TYPE,
    DISABLE: EDITOR_DISABLE_MESSAGE_TYPE,
    SELECT: EDITOR_SELECT_MESSAGE_TYPE,
    CLEAR_SELECTION: EDITOR_CLEAR_SELECTION_MESSAGE_TYPE,
    START_TEXT_EDIT: EDITOR_START_TEXT_EDIT_MESSAGE_TYPE,
    CANCEL_TEXT_EDIT: EDITOR_CANCEL_TEXT_EDIT_MESSAGE_TYPE,
    REQUEST_GEOMETRY: EDITOR_REQUEST_GEOMETRY_MESSAGE_TYPE,
    SET_TOOL: EDITOR_SET_TOOL_MESSAGE_TYPE,
    READY: EDITOR_READY_MESSAGE_TYPE,
    SHORTCUT: EDITOR_SHORTCUT_MESSAGE_TYPE,
    HOVER: EDITOR_HOVER_MESSAGE_TYPE,
    SELECTION_CHANGE: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
    GEOMETRY: EDITOR_GEOMETRY_MESSAGE_TYPE,
    TEXT_COMMIT: EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
    TEXT_EDIT_STATE: EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
    TRANSFORM_PREVIEW: EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
    TRANSFORM_COMMIT: EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
    TRANSFORM_CANCEL: EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE,
    DELETE_REQUEST: EDITOR_DELETE_REQUEST_MESSAGE_TYPE,
    INSERT_REQUEST: EDITOR_INSERT_REQUEST_MESSAGE_TYPE,
    ERROR: EDITOR_ERROR_MESSAGE_TYPE,
    SELECTORS: [...options.slideSelectors],
    PARENT_ORIGIN: options.parentOrigin?.trim() || '',
    ELEMENT_ID_ATTR: ARK_ELEMENT_ID_ATTR,
    LOCKED_ATTR: ARK_LOCKED_ATTR,
    MANAGED_ATTR: 'data-ark-managed',
    EDITABLE_ATTR: 'data-ark-editable',
    ROLE_ATTR: 'data-ark-role',
    TRANSIENT_PREFIX: TRANSIENT_ELEMENT_ID_PREFIX,
    INLINE_TEXT_TAGS: [...INLINE_TEXT_EDITABLE_TAGS],
    TEXT_BOX_EDITABLE: ARK_TEXT_BOX_EDITABLE_VALUE,
    TEXT_BOX_CLASS: ARK_TEXT_BOX_CLASS,
    MIN_BOX_SIZE: MIN_TEXT_BOX_NORMALIZED_SIZE,
    DEFAULT_BOX_WIDTH: DEFAULT_TEXT_BOX_NORMALIZED_SIZE.width,
    DEFAULT_BOX_HEIGHT: DEFAULT_TEXT_BOX_NORMALIZED_SIZE.height,
    SLIDE_REFERENCE_WIDTH: ARK_SLIDE_REFERENCE_WIDTH,
    SLIDE_REFERENCE_HEIGHT: ARK_SLIDE_REFERENCE_HEIGHT,
  }

  return `
(function () {
  var C = ${JSON.stringify(constants)};
  var enabled = false;
  var currentTool = 'select';
  var currentSlideIndex = 0;
  var selectedElement = null;
  var textEditElement = null;
  var originalTextBeforeEdit = null;
  var listenersBound = false;
  var transformState = null;
  var editorScale = 1;
  var marqueeElement = null;
  var resizeHandles = [];
  var guideElements = [];
  var hoveredElement = null;
  var editorStyle = null;
  var nudgeState = null;

  function isRecord(value) {
    return typeof value === 'object' && value !== null;
  }

  function clampIndex(index, count) {
    if (!Number.isFinite(index) || count <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(count - 1, Math.floor(index)));
  }

  function postToParent(message) {
    if (window.parent !== window) {
      window.parent.postMessage(message, C.PARENT_ORIGIN || '*');
    }
  }

  function postError(message, code) {
    postToParent({
      type: C.ERROR,
      message: String(message),
      code: code || undefined,
    });
  }

  function findSlides() {
    var revealSlides = document.querySelector('.reveal .slides');

    if (revealSlides) {
      var flattened = [];
      var horizontal = Array.prototype.filter.call(revealSlides.children, function (element) {
        return element.tagName && element.tagName.toLowerCase() === 'section';
      });

      horizontal.forEach(function (section) {
        var vertical = Array.prototype.filter.call(section.children, function (element) {
          return element.tagName && element.tagName.toLowerCase() === 'section';
        });
        Array.prototype.push.apply(flattened, vertical.length ? vertical : [section]);
      });

      if (flattened.length) {
        return flattened;
      }
    }

    for (var i = 0; i < C.SELECTORS.length; i++) {
      var found = document.querySelectorAll(C.SELECTORS[i]);

      if (found.length) {
        return Array.prototype.slice.call(found);
      }
    }

    return [];
  }

  function getActiveSlide() {
    var slides = findSlides();

    return slides[clampIndex(currentSlideIndex, slides.length)] || null;
  }

  function getElementPath(element, slide) {
    var path = [];
    var current = element;

    while (current && current !== slide) {
      var parent = current.parentElement;

      if (!parent) {
        break;
      }

      var index = Array.prototype.indexOf.call(parent.children, current);
      path.unshift(index);
      current = parent;
    }

    return path.join('.');
  }

  function resolveElementId(element, slide, slideIndex) {
    var nativeId = element.getAttribute(C.ELEMENT_ID_ATTR);

    if (nativeId && nativeId.trim()) {
      return nativeId.trim();
    }

    return C.TRANSIENT_PREFIX + slideIndex + '-' + getElementPath(element, slide);
  }

  function isUnsafeTag(tag) {
    return (
      tag === 'script' ||
      tag === 'style' ||
      tag === 'iframe' ||
      tag === 'form' ||
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select'
    );
  }

  function isEditableCandidate(element, slide) {
    if (!element || element === slide || !slide.contains(element)) {
      return false;
    }

    var tag = element.tagName.toLowerCase();

    if (isUnsafeTag(tag)) {
      return false;
    }

    if (tag === 'aside' && element.classList.contains('notes')) {
      return false;
    }

    if (element.closest('[data-ark-editor-handle], [data-ark-editor-marquee], [data-ark-editor-guide]')) {
      return false;
    }

    var bounds = element.getBoundingClientRect();

    if (!bounds.width || !bounds.height) {
      return false;
    }

    if (element.getAttribute(C.LOCKED_ATTR) === 'true') {
      return true;
    }

    if (element.hasAttribute(C.ELEMENT_ID_ATTR)) {
      return true;
    }

    if (
      element.getAttribute(C.EDITABLE_ATTR) === C.TEXT_BOX_EDITABLE ||
      element.classList.contains(C.TEXT_BOX_CLASS)
    ) {
      return true;
    }

    return (
      tag === 'h1' ||
      tag === 'h2' ||
      tag === 'h3' ||
      tag === 'h4' ||
      tag === 'h5' ||
      tag === 'h6' ||
      tag === 'p' ||
      tag === 'li' ||
      tag === 'button' ||
      tag === 'figcaption' ||
      tag === 'span' ||
      tag === 'img' ||
      tag === 'svg' ||
      tag === 'div' ||
      tag === 'section' ||
      tag === 'ul' ||
      tag === 'ol' ||
      tag === 'table' ||
      tag === 'blockquote' ||
      tag === 'pre' ||
      tag === 'figure' ||
      tag === 'a' ||
      tag === 'hr'
    );
  }

  function findManagedAncestor(element, slide) {
    var current = element;

    while (current && current !== slide) {
      if (current.nodeType === 1 && isManagedElement(current) && isEditableCandidate(current, slide)) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function findEditableTarget(node, slide) {
    var current = node;

    while (current && current !== slide) {
      if (current.nodeType === 1 && isEditableCandidate(current, slide)) {
        var managedAncestor = findManagedAncestor(current, slide);

        // First click selects a managed group; later clicks stay drilled into it
        // (or deepen) while selection remains inside the group. Text boxes stay
        // one object because their child stores the editable text.
        var drilled =
          managedAncestor === selectedElement ||
          (selectedElement && managedAncestor.contains(selectedElement));

        return managedAncestor && (isTextBox(managedAncestor) || !drilled)
          ? managedAncestor
          : current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function readTextPreview(element) {
    var text = (element.textContent || '').replace(/\\s+/g, ' ').trim();

    if (!text && element.getAttribute('alt')) {
      text = element.getAttribute('alt') || '';
    }

    return text || null;
  }

  function isTextEditableTag(tag) {
    return C.INLINE_TEXT_TAGS.indexOf(tag) !== -1;
  }

  function postTextEditState(active, elementId, slideIndex) {
    if (active) {
      postToParent({
        type: C.TEXT_EDIT_STATE,
        active: true,
        elementId: elementId,
        slideIndex: slideIndex,
      });
      return;
    }

    postToParent({ type: C.TEXT_EDIT_STATE, active: false });
  }

  function readImageFit(element) {
    if (!isImageElement(element)) {
      return null;
    }

    var stored = element.getAttribute('data-ark-fit');

    if (stored === 'contain' || stored === 'cover' || stored === 'fill') {
      return stored;
    }

    var computed = window.getComputedStyle(element).objectFit;

    if (computed === 'cover' || computed === 'fill') {
      return computed;
    }

    return 'contain';
  }

  function readTextStyle(element) {
    if (isImageElement(element)) {
      return null;
    }

    var target = getTextEditTarget(element) || element;
    var computed = window.getComputedStyle(target);
    var fontSize = Number.parseFloat(computed.fontSize);
    var lineHeight = Number.parseFloat(computed.lineHeight);

    if (!Number.isFinite(fontSize)) {
      return null;
    }

    return {
      fontSize: fontSize,
      fontWeight: String(computed.fontWeight || '400'),
      color: String(computed.color || ''),
      textAlign: String(computed.textAlign || ''),
      lineHeight: Number.isFinite(lineHeight) ? lineHeight : null,
    };
  }

  function readImageNaturalSize(element) {
    if (
      element.tagName.toLowerCase() === 'img' &&
      element.naturalWidth > 0 &&
      element.naturalHeight > 0
    ) {
      return { width: element.naturalWidth, height: element.naturalHeight };
    }

    return null;
  }

  function buildSelection(element, slide, slideIndex) {
    return {
      elementId: resolveElementId(element, slide, slideIndex),
      slideIndex: slideIndex,
      slideId: slide.getAttribute('data-ark-slide-id') || null,
      tagName: element.tagName.toLowerCase(),
      locked: element.getAttribute(C.LOCKED_ATTR) === 'true',
      managed: isManagedElement(element),
      editableKind: element.getAttribute(C.EDITABLE_ATTR) || null,
      textPreview: readTextPreview(element),
      imageFit: readImageFit(element),
      surface: detectSurface(element, slide),
      geometryEditable: canEditInspectorGeometry(element, slide),
      role: element.getAttribute(C.ROLE_ATTR) || null,
      textStyle: readTextStyle(element),
      imageNaturalSize: readImageNaturalSize(element),
    };
  }

  function parseColor(value) {
    var match = String(value || '').match(/rgba?\\(([^)]+)\\)/i);

    if (!match) {
      try {
        var canvas = parseColor.canvas || (parseColor.canvas = document.createElement('canvas'));
        canvas.width = 1;
        canvas.height = 1;
        var context = canvas.getContext && canvas.getContext('2d');

        if (!context) {
          return null;
        }

        context.clearRect(0, 0, 1, 1);
        context.fillStyle = '#010203';
        var sentinel = context.fillStyle;
        context.fillStyle = String(value || '');

        if (context.fillStyle === sentinel) {
          return null;
        }

        context.fillRect(0, 0, 1, 1);
        var pixel = context.getImageData(0, 0, 1, 1).data;
        return { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] / 255 };
      } catch (error) {
        return null;
      }
    }

    var parts = match[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);

    if (parts.length < 3 || parts.some(function (part) { return !Number.isFinite(part); })) {
      return null;
    }

    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  function compositeColor(foreground, background) {
    var alpha = foreground.a + background.a * (1 - foreground.a);

    if (!alpha) {
      return { r: 255, g: 255, b: 255, a: 0 };
    }

    return {
      r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
      g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
      b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
      a: alpha,
    };
  }

  function colorSurface(color) {
    var channels = [color.r, color.g, color.b].map(function (channel) {
      var value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    var luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];

    return luminance >= 0.5 ? 'light' : 'dark';
  }

  function averageGradient(image) {
    var value = String(image || '');

    if (!/gradient\\(/i.test(value)) {
      return null;
    }

    var matches = value.replace(/url\\([^)]*\\)/gi, '').match(/rgba?\\([^)]+\\)/gi) || [];
    var colors = matches.map(parseColor).filter(Boolean);

    if (!colors.length) {
      return null;
    }

    return {
      r: colors.reduce(function (sum, color) { return sum + color.r; }, 0) / colors.length,
      g: colors.reduce(function (sum, color) { return sum + color.g; }, 0) / colors.length,
      b: colors.reduce(function (sum, color) { return sum + color.b; }, 0) / colors.length,
      a: 1,
    };
  }

  function detectSurface(element, slide) {
    var current = element;
    var foreground = null;
    var gradient = null;

    while (current && current.nodeType === 1) {
      var computed = window.getComputedStyle(current);
      var color = parseColor(computed.backgroundColor);

      if (color && color.a > 0) {
        foreground = foreground ? compositeColor(foreground, color) : color;

        if (foreground.a >= 0.99) {
          return colorSurface(foreground);
        }
      }

      if (!gradient && computed.backgroundImage && computed.backgroundImage !== 'none') {
        gradient = averageGradient(computed.backgroundImage);
      }

      current = current.parentElement;
    }

    if (foreground) {
      return colorSurface(compositeColor(foreground, { r: 255, g: 255, b: 255, a: 1 }));
    }

    return gradient ? colorSurface(gradient) : 'light';
  }

  function getSlideCoordinateElement(slide) {
    return slide.closest('.reveal .slides') || slide;
  }

  function getSlideCoordinateRect(slide) {
    return getSlideCoordinateElement(slide).getBoundingClientRect();
  }

  function getSlideLogicalWidth(slide) {
    var coordinateElement = getSlideCoordinateElement(slide);
    return coordinateElement.offsetWidth || getSlideCoordinateRect(slide).width;
  }

  function getSlideLogicalHeight(slide) {
    var coordinateElement = getSlideCoordinateElement(slide);
    return coordinateElement.offsetHeight || getSlideCoordinateRect(slide).height;
  }

  function canEditInspectorGeometry(element, slide) {
    var context = readPositionContext(element, slide);

    return (
      context.containingBlock === slide &&
      Math.abs(getSlideLogicalWidth(slide) - C.SLIDE_REFERENCE_WIDTH) < 0.5 &&
      Math.abs(getSlideLogicalHeight(slide) - C.SLIDE_REFERENCE_HEIGHT) < 0.5
    );
  }

  function normalizeRect(element, slide) {
    var slideRect = getSlideCoordinateRect(slide);
    var elementRect = element.getBoundingClientRect();

    if (!slideRect.width || !slideRect.height) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    return {
      x: (elementRect.left - slideRect.left) / slideRect.width,
      y: (elementRect.top - slideRect.top) / slideRect.height,
      width: elementRect.width / slideRect.width,
      height: elementRect.height / slideRect.height,
    };
  }

  function normalizeSlideBounds(slide) {
    var viewport = document.documentElement.getBoundingClientRect();
    var slideRect = getSlideCoordinateRect(slide);

    if (!viewport.width || !viewport.height || !slideRect.width || !slideRect.height) {
      return { x: 0, y: 0, width: 1, height: 1 };
    }

    return {
      x: (slideRect.left - viewport.left) / viewport.width,
      y: (slideRect.top - viewport.top) / viewport.height,
      width: slideRect.width / viewport.width,
      height: slideRect.height / viewport.height,
    };
  }

  function readZIndex(element) {
    var value = window.getComputedStyle(element).zIndex;
    var parsed = Number.parseInt(value, 10);

    return Number.isFinite(parsed) ? parsed : null;
  }

  function clampUnit(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(1, value));
  }

  function clampRect(rect) {
    var width = Math.max(C.MIN_BOX_SIZE, clampUnit(rect.width));
    var height = Math.max(C.MIN_BOX_SIZE, clampUnit(rect.height));
    var x = clampUnit(rect.x);
    var y = clampUnit(rect.y);

    return {
      x: Math.min(x, Math.max(0, 1 - width)),
      y: Math.min(y, Math.max(0, 1 - height)),
      width: width,
      height: height,
    };
  }

  function pointerToNormalized(clientX, clientY, slide) {
    var slideRect = getSlideCoordinateRect(slide);

    if (!slideRect.width || !slideRect.height) {
      return { x: 0, y: 0 };
    }

    return {
      x: clampUnit((clientX - slideRect.left) / slideRect.width),
      y: clampUnit((clientY - slideRect.top) / slideRect.height),
    };
  }

  function isTextBox(element) {
    if (!element) {
      return false;
    }

    return (
      element.getAttribute(C.EDITABLE_ATTR) === C.TEXT_BOX_EDITABLE ||
      element.classList.contains(C.TEXT_BOX_CLASS)
    );
  }

  function isImageElement(element) {
    if (!element) {
      return false;
    }

    var tag = element.tagName.toLowerCase();

    return (
      tag === 'img' ||
      tag === 'svg' ||
      tag === 'picture' ||
      element.getAttribute(C.EDITABLE_ATTR) === 'image'
    );
  }

  function getImageAspectRatio(element) {
    var stored = element.getAttribute('data-ark-aspect-ratio');
    var parsed = stored ? Number.parseFloat(stored) : NaN;

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    if (element.naturalWidth && element.naturalHeight) {
      return element.naturalWidth / element.naturalHeight;
    }

    var bounds = element.getBoundingClientRect();

    if (bounds.width > 0 && bounds.height > 0) {
      return bounds.width / bounds.height;
    }

    return 1;
  }

  function applyImageAspectRatio(rect, aspectRatio, slide, start) {
    var slideRect = getSlideCoordinateRect(slide);

    if (!slideRect.width || !slideRect.height || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
      return rect;
    }

    var slideAspect = slideRect.width / slideRect.height;
    var widthDelta = Math.abs(rect.width - start.width);
    var heightDelta = Math.abs(rect.height - start.height);

    if (heightDelta > widthDelta) {
      rect.width = rect.height * aspectRatio / slideAspect;
    } else {
      rect.height = rect.width * slideAspect / aspectRatio;
    }

    return clampRect(rect);
  }

  function isManagedElement(element) {
    if (!element) {
      return false;
    }

    if (element.getAttribute(C.MANAGED_ATTR) === 'true' || isTextBox(element)) {
      return true;
    }

    var style = window.getComputedStyle(element);
    return style.position === 'absolute' && style.left !== 'auto' && style.top !== 'auto';
  }

  function getTextEditTarget(element) {
    if (!element) {
      return null;
    }

    if (isTextBox(element)) {
      var child = element.querySelector('p, h1, h2, h3, h4, h5, h6, span, li, blockquote, figcaption');

      return child || element;
    }

    return element;
  }

  function clearMarquee() {
    if (marqueeElement && marqueeElement.parentElement) {
      marqueeElement.parentElement.removeChild(marqueeElement);
    }

    marqueeElement = null;
  }

  function clearResizeHandles() {
    for (var i = 0; i < resizeHandles.length; i++) {
      if (resizeHandles[i].parentElement) {
        resizeHandles[i].parentElement.removeChild(resizeHandles[i]);
      }
    }

    resizeHandles = [];
  }

  function clearGuides() {
    for (var i = 0; i < guideElements.length; i++) {
      if (guideElements[i].parentElement) {
        guideElements[i].parentElement.removeChild(guideElements[i]);
      }
    }

    guideElements = [];
  }

  function clearHoverCursor() {
    if (hoveredElement) {
      hoveredElement.removeAttribute('data-ark-editor-movable');
    }

    hoveredElement = null;
  }

  function setHoverCursor(element) {
    if (hoveredElement === element) {
      return false;
    }

    clearHoverCursor();
    hoveredElement = element;

    if (hoveredElement && hoveredElement.getAttribute(C.LOCKED_ATTR) !== 'true') {
      hoveredElement.setAttribute('data-ark-editor-movable', 'true');
    }

    return true;
  }

  function ensureEditorStyle() {
    if (editorStyle && editorStyle.parentElement) {
      return;
    }

    editorStyle = document.createElement('style');
    editorStyle.setAttribute('data-ark-editor', 'true');
    editorStyle.textContent = '[data-ark-editor-movable="true"],[data-ark-editor-movable="true"] *{cursor:move!important}';
    (document.head || document.documentElement).appendChild(editorStyle);
  }

  function clearEditorOverlays() {
    clearMarquee();
    clearResizeHandles();
    clearGuides();
  }

  function updateResizeHandles(element, slide) {
    if (!element || !slide || element.getAttribute(C.LOCKED_ATTR) === 'true') {
      clearResizeHandles();
      return;
    }

    var rect = normalizeRect(element, slide);
    var overlayRoot = getSlideCoordinateElement(slide);
    var handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    var cursors = { nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize' };

    if (resizeHandles.length !== handles.length || resizeHandles[0].parentElement !== overlayRoot) {
      clearResizeHandles();

      for (var i = 0; i < handles.length; i++) {
        var handle = document.createElement('div');
        var dot = document.createElement('div');
        handle.setAttribute('data-ark-editor-handle', handles[i]);
        handle.style.position = 'absolute';
        handle.style.zIndex = '10000';
        handle.style.pointerEvents = 'auto';
        handle.style.boxSizing = 'border-box';
        handle.style.cursor = cursors[handles[i]];
        dot.style.position = 'absolute';
        dot.style.left = '50%';
        dot.style.top = '50%';
        dot.style.transform = 'translate(-50%, -50%)';
        dot.style.background = '#ffffff';
        dot.style.border = 1 / editorScale + 'px solid #6b7280';
        dot.style.borderRadius = '50%';
        dot.style.boxShadow = '0 1px ' + 3 / editorScale + 'px rgba(0, 0, 0, 0.45)';
        dot.style.pointerEvents = 'none';
        handle.appendChild(dot);
        overlayRoot.appendChild(handle);
        resizeHandles.push(handle);
      }
    }

    for (var j = 0; j < resizeHandles.length; j++) {
      var hitSize = 18 / editorScale;
      var visualSize = 10 / editorScale;
      resizeHandles[j].style.width = hitSize + 'px';
      resizeHandles[j].style.height = hitSize + 'px';
      resizeHandles[j].firstChild.style.width = visualSize + 'px';
      resizeHandles[j].firstChild.style.height = visualSize + 'px';
      resizeHandles[j].firstChild.style.borderWidth = 1 / editorScale + 'px';
      positionResizeHandle(resizeHandles[j], handles[j], rect, slide);
    }
  }

  function positionResizeHandle(handle, kind, rect, slide) {
    var slideWidth = getSlideLogicalWidth(slide);
    var slideHeight = getSlideLogicalHeight(slide);
    var left = rect.x * slideWidth;
    var top = rect.y * slideHeight;
    var width = rect.width * slideWidth;
    var height = rect.height * slideHeight;
    var size = 18 / editorScale;

    if (kind.indexOf('n') !== -1) {
      handle.style.top = top - size / 2 + 'px';
    } else if (kind.indexOf('s') !== -1) {
      handle.style.top = top + height - size / 2 + 'px';
    } else {
      handle.style.top = top + height / 2 - size / 2 + 'px';
    }

    if (kind.indexOf('w') !== -1) {
      handle.style.left = left - size / 2 + 'px';
    } else if (kind.indexOf('e') !== -1) {
      handle.style.left = left + width - size / 2 + 'px';
    } else {
      handle.style.left = left + width / 2 - size / 2 + 'px';
    }
  }

  function refreshSelectionChrome(element, slide, slideIndex) {
    updateResizeHandles(element, slide);

    if (element) {
      postGeometryForElement(element, slide, slideIndex);
    }
  }

  function clearSelectionStyles() {
    if (selectedElement) {
      selectedElement.removeAttribute('data-ark-editor-selected');
    }

    selectedElement = null;
  }

  function setSelectedElement(element, slide, slideIndex) {
    if (nudgeState && nudgeState.element !== element) {
      finishNudge();
    }

    clearSelectionStyles();
    selectedElement = element;

    if (selectedElement) {
      selectedElement.setAttribute('data-ark-editor-selected', '');

      if (slide) {
        refreshSelectionChrome(selectedElement, slide, slideIndex);
      }
    } else {
      clearEditorOverlays();
    }
  }

  function postSelection(element, slide, slideIndex) {
    if (!element) {
      postToParent({ type: C.SELECTION_CHANGE, selection: null });
      return;
    }

    postToParent({
      type: C.SELECTION_CHANGE,
      selection: buildSelection(element, slide, slideIndex),
    });
  }

  function findElementById(elementId, slide, slideIndex) {
    var byAttr = slide.querySelector('[' + C.ELEMENT_ID_ATTR + '="' + elementId.replace(/"/g, '') + '"]');

    if (byAttr) {
      return byAttr;
    }

    if (elementId.indexOf(C.TRANSIENT_PREFIX) !== 0) {
      return null;
    }

    var suffix = elementId.slice(C.TRANSIENT_PREFIX.length);
    var dashIndex = suffix.indexOf('-');

    if (dashIndex === -1) {
      return null;
    }

    var path = suffix.slice(dashIndex + 1);

    var indices = path.split('.').map(function (part) {
      return Number.parseInt(part, 10);
    });
    var current = slide;

    for (var i = 0; i < indices.length; i++) {
      if (!current || !current.children || !current.children[indices[i]]) {
        return null;
      }

      current = current.children[indices[i]];
    }

    return current;
  }

  function postGeometryForElement(element, slide, slideIndex) {
    postToParent({
      type: C.GEOMETRY,
      elementId: resolveElementId(element, slide, slideIndex),
      slideIndex: slideIndex,
      geometry: normalizeRect(element, slide),
      zIndex: readZIndex(element),
      slideBounds: normalizeSlideBounds(slide),
      surface: detectSurface(element, slide),
    });
  }

  function endTextEdit(commit) {
    if (!textEditElement) {
      return;
    }

    var slide = getActiveSlide();
    var element = textEditElement;
    var slideIndex = currentSlideIndex;
    var savedOriginalText = originalTextBeforeEdit;

    if (!commit && originalTextBeforeEdit !== null) {
      element.textContent = originalTextBeforeEdit;
    }

    textEditElement.removeAttribute('contenteditable');
    textEditElement.removeAttribute('data-ark-editor-text-edit');

    if (commit && slide) {
      postToParent({
        type: C.TEXT_COMMIT,
        elementId: resolveElementId(element, slide, slideIndex),
        slideIndex: slideIndex,
        slideId: slide.getAttribute('data-ark-slide-id') || null,
        text: element.textContent || '',
        originalText: savedOriginalText || '',
      });
    }

    postTextEditState(false);
    originalTextBeforeEdit = null;
    textEditElement = null;
  }

  function startTextEditOnElement(element, slide, slideIndex) {
    var target = getTextEditTarget(element);

    if (!target) {
      postError('Element is not text-editable.', 'non-text-element');
      return;
    }

    if (element.getAttribute(C.LOCKED_ATTR) === 'true') {
      postError('Element is locked.', 'locked-element');
      return;
    }

    var tag = target.tagName.toLowerCase();

    if (!isTextEditableTag(tag) && !isTextBox(element)) {
      postError('Element is not text-editable.', 'non-text-element');
      return;
    }

    endTextEdit(false);
    clearHoverCursor();
    clearEditorOverlays();
    textEditElement = target;
    originalTextBeforeEdit = target.textContent || '';
    target.setAttribute('contenteditable', 'true');
    target.setAttribute('data-ark-editor-text-edit', '');
    target.focus();

    try {
      var selection = window.getSelection();

      if (selection) {
        var range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch (error) {
      // Ignore selection failures in older browsers.
    }

    postTextEditState(
      true,
      resolveElementId(element, slide, slideIndex),
      slideIndex,
    );
  }

  function applyTransform(element, slide, geometry, preview, mode, adopted, positionContext) {
    var slideRect = getSlideCoordinateRect(slide);
    var rect = clampRect(geometry);

    if (!slideRect.width || !slideRect.height) {
      return rect;
    }

    element.style.position = 'absolute';
    var cssPosition = preview
      ? setSlideRelativePosition(element, slide, rect, positionContext)
      : settleSlideRelativePosition(element, slide, rect, positionContext);

    // A pure move must not touch the element size. Only rewrite width/height
    // during a resize, otherwise elements sized with an explicit height would
    // silently change dimensions when merely repositioned.
    if (mode !== 'move') {
      var containingScale = positionContext
        ? { x: positionContext.scaleX, y: positionContext.scaleY }
        : readContainingBlockScale(element, slide);
      element.style.width = rect.width * slideRect.width / containingScale.x + 'px';

      if (isImageElement(element)) {
        element.style.height = rect.height * slideRect.height / containingScale.y + 'px';
        element.style.minHeight = '';
      } else {
        element.style.minHeight = rect.height * slideRect.height / containingScale.y + 'px';
        element.style.height = '';
      }
    }

    if (preview) {
      postToParent({
        type: C.TRANSFORM_PREVIEW,
        elementId: resolveElementId(element, slide, currentSlideIndex),
        slideIndex: currentSlideIndex,
        geometry: rect,
        zIndex: readZIndex(element),
        slideBounds: normalizeSlideBounds(slide),
      });
    } else {
      var logicalSlideWidth = getSlideLogicalWidth(slide);
      var logicalSlideHeight = getSlideLogicalHeight(slide);
      postToParent({
        type: C.TRANSFORM_COMMIT,
        elementId: resolveElementId(element, slide, currentSlideIndex),
        slideIndex: currentSlideIndex,
        geometry: rect,
        zIndex: readZIndex(element),
        slideBounds: normalizeSlideBounds(slide),
        adopted: adopted ? true : undefined,
        cssX: cssPosition.x,
        cssY: cssPosition.y,
        cssWidth: adopted || mode !== 'move'
          ? readLogicalWidth(element, slide) / logicalSlideWidth
          : undefined,
        cssHeight: mode !== 'move'
          ? readLogicalHeight(element, slide) / logicalSlideHeight
          : undefined,
        slideWidth: logicalSlideWidth,
        slideHeight: logicalSlideHeight,
      });
    }

    refreshSelectionChrome(element, slide, currentSlideIndex);
    return rect;
  }

  function resizeRectWithHandle(startGeometry, handle, pointer, slide, element) {
    var start = clampRect(startGeometry);
    var current = pointerToNormalized(pointer.clientX, pointer.clientY, slide);
    var rect = {
      x: start.x,
      y: start.y,
      width: start.width,
      height: start.height,
    };

    if (handle.indexOf('e') !== -1) {
      rect.width = Math.max(C.MIN_BOX_SIZE, current.x - start.x);
    }

    if (handle.indexOf('s') !== -1) {
      rect.height = Math.max(C.MIN_BOX_SIZE, current.y - start.y);
    }

    if (handle.indexOf('w') !== -1) {
      rect.width = Math.max(C.MIN_BOX_SIZE, start.x + start.width - current.x);
      rect.x = current.x;
    }

    if (handle.indexOf('n') !== -1) {
      rect.height = Math.max(C.MIN_BOX_SIZE, start.y + start.height - current.y);
      rect.y = current.y;
    }

    var cornerHandle = handle.length === 2;

    if (element && (isImageElement(element) || (pointer.shiftKey && cornerHandle))) {
      var aspectRatio = isImageElement(element)
        ? getImageAspectRatio(element)
        : start.width / Math.max(start.height, C.MIN_BOX_SIZE) *
          getSlideCoordinateRect(slide).width / getSlideCoordinateRect(slide).height;
      var locked = applyImageAspectRatio(rect, aspectRatio, slide, start);

      if (handle.indexOf('w') !== -1) {
        locked.x = start.x + start.width - locked.width;
      }

      if (handle.indexOf('n') !== -1) {
        locked.y = start.y + start.height - locked.height;
      }

      return locked;
    }

    return clampRect(rect);
  }

  function findResizeHandle(target) {
    if (!target || !target.getAttribute) {
      return null;
    }

    if (target.getAttribute('data-ark-editor-handle')) {
      return target.getAttribute('data-ark-editor-handle');
    }

    return null;
  }

  function snapshotInlineStyle(element) {
    return {
      hadStyle: element.hasAttribute('style'),
      style: element.getAttribute('style') || '',
    };
  }

  function restoreInlineStyle(element, snapshot) {
    if (!snapshot) {
      return;
    }

    if (snapshot.hadStyle) {
      element.setAttribute('style', snapshot.style);
    } else {
      element.removeAttribute('style');
    }
  }

  function findContainingBlock(element, slide) {
    if (element.offsetParent) {
      return element.offsetParent;
    }

    var parent = element.parentElement;

    while (parent) {
      var style = window.getComputedStyle(parent);

      if (
        (style.position && style.position !== 'static') ||
        (style.transform && style.transform !== 'none')
      ) {
        return parent;
      }

      parent = parent.parentElement;
    }

    return document.documentElement || slide;
  }

  function readLogicalWidth(element, slide) {
    if (element.offsetWidth) {
      return element.offsetWidth;
    }

    if (element.style.width && /px$/i.test(element.style.width)) {
      return Number.parseFloat(element.style.width) || 0;
    }

    var scale = readContainingBlockScale(element, slide).x;
    return element.getBoundingClientRect().width / scale;
  }

  function readLogicalHeight(element, slide) {
    if (element.offsetHeight) {
      return element.offsetHeight;
    }

    if (element.style.height && /px$/i.test(element.style.height)) {
      return Number.parseFloat(element.style.height) || 0;
    }

    if (element.style.minHeight && /px$/i.test(element.style.minHeight)) {
      return Number.parseFloat(element.style.minHeight) || 0;
    }

    var scale = readContainingBlockScale(element, slide).y;
    return element.getBoundingClientRect().height / scale;
  }

  function readPositionContext(element, slide) {
    var containingBlock = findContainingBlock(element, slide);
    var blockRect = containingBlock.getBoundingClientRect();
    var blockWidth = containingBlock.offsetWidth;
    var blockHeight = containingBlock.offsetHeight;
    var scaleRect = blockRect;

    if (containingBlock === slide && (!blockRect.width || !blockRect.height)) {
      scaleRect = getSlideCoordinateRect(slide);
      blockWidth = getSlideLogicalWidth(slide);
      blockHeight = getSlideLogicalHeight(slide);
    }

    return {
      containingBlock: containingBlock,
      scaleX: (blockWidth ? scaleRect.width / blockWidth : 1) || 1,
      scaleY: (blockHeight ? scaleRect.height / blockHeight : 1) || 1,
    };
  }

  function readContainingBlockScale(element, slide) {
    var context = readPositionContext(element, slide);
    return { x: context.scaleX, y: context.scaleY };
  }

  function setSlideRelativePosition(element, slide, geometry, positionContext) {
    var slideRect = getSlideCoordinateRect(slide);
    var context = positionContext || readPositionContext(element, slide);
    var containingBlock = context.containingBlock;
    var blockRect = containingBlock.getBoundingClientRect();
    var scaleX = context.scaleX;
    var scaleY = context.scaleY;
    var style = window.getComputedStyle(element);
    var marginLeft = Number.parseFloat(style.marginLeft) || 0;
    var marginTop = Number.parseFloat(style.marginTop) || 0;
    var targetLeft = slideRect.left + geometry.x * slideRect.width;
    var targetTop = slideRect.top + geometry.y * slideRect.height;
    var left = (targetLeft - blockRect.left) / scaleX - (containingBlock.clientLeft || 0) +
      (containingBlock.scrollLeft || 0) - marginLeft;
    var top = (targetTop - blockRect.top) / scaleY - (containingBlock.clientTop || 0) +
      (containingBlock.scrollTop || 0) - marginTop;

    element.style.left = left + 'px';
    element.style.top = top + 'px';
    return {
      x: left / getSlideLogicalWidth(slide),
      y: top / getSlideLogicalHeight(slide),
    };
  }

  function settleSlideRelativePosition(element, slide, geometry, positionContext) {
    var position = setSlideRelativePosition(element, slide, geometry, positionContext);
    var reveal = window.Reveal;

    if (
      getSlideCoordinateElement(slide) === slide ||
      !reveal ||
      typeof reveal.layout !== 'function'
    ) {
      return position;
    }

    // Reveal centers each section from its scrollHeight. Absolute children can
    // change that height, so converge the local CSS offset before persisting.
    for (var i = 0; i < 6; i++) {
      reveal.layout();
      position = setSlideRelativePosition(element, slide, geometry, positionContext);
    }

    return position;
  }

  function adoptMove(element, slide, geometry, logicalWidth, positionContext) {
    element.style.position = 'absolute';
    element.style.margin = '0px';
    element.style.boxSizing = 'border-box';
    element.style.width = logicalWidth + 'px';
    setSlideRelativePosition(element, slide, geometry, positionContext);
  }

  function prepareMove(element, slide, activate) {
    var geometry = normalizeRect(element, slide);
    var snapshot = snapshotInlineStyle(element);
    var adopted = window.getComputedStyle(element).position !== 'absolute';
    var logicalWidth = readLogicalWidth(element, slide);
    var positionContext = readPositionContext(element, slide);

    if (adopted && activate !== false) {
      adoptMove(element, slide, geometry, logicalWidth, positionContext);
    }

    return {
      geometry: geometry,
      snapshot: snapshot,
      adopted: adopted,
      logicalWidth: logicalWidth,
      positionContext: positionContext,
    };
  }

  function collectSnapRects(slide, element) {
    var descendants = slide.querySelectorAll('*');
    var candidates = [];

    for (var i = 0; i < descendants.length && candidates.length < 60; i++) {
      var candidate = descendants[i];

      if (
        candidate !== element &&
        !element.contains(candidate) &&
        !candidate.contains(element) &&
        isEditableCandidate(candidate, slide)
      ) {
        candidates.push(candidate);
      }
    }

    // ponytail: measure at most 60 objects per gesture; spatial indexing can replace this if large decks need it.
    return candidates.map(function (candidate) { return normalizeRect(candidate, slide); });
  }

  function closestSnap(moving, targets, threshold) {
    var best = null;

    for (var i = 0; i < moving.length; i++) {
      for (var j = 0; j < targets.length; j++) {
        var difference = targets[j] - moving[i];

        if (Math.abs(difference) <= threshold && (!best || Math.abs(difference) < Math.abs(best.difference))) {
          best = { difference: difference, target: targets[j] };
        }
      }
    }

    return best;
  }

  function showGuide(slide, axis, position) {
    var guide = document.createElement('div');
    guide.setAttribute('data-ark-editor-guide', 'true');
    guide.style.position = 'absolute';
    guide.style.pointerEvents = 'none';
    guide.style.background = '#ef4444';
    guide.style.zIndex = '10001';

    if (axis === 'x') {
      guide.style.left = position * getSlideLogicalWidth(slide) + 'px';
      guide.style.top = '0';
      guide.style.width = 1 / editorScale + 'px';
      guide.style.height = '100%';
    } else {
      guide.style.left = '0';
      guide.style.top = position * getSlideLogicalHeight(slide) + 'px';
      guide.style.width = '100%';
      guide.style.height = 1 / editorScale + 'px';
    }

    getSlideCoordinateElement(slide).appendChild(guide);
    guideElements.push(guide);
  }

  function snapMoveRect(rect, snapRects, slide, disabled, constrainedAxis) {
    clearGuides();

    if (disabled) {
      return clampRect(rect);
    }

    var slideRect = getSlideCoordinateRect(slide);
    var xTargets = [0, 0.5, 1];
    var yTargets = [0, 0.5, 1];

    for (var i = 0; i < snapRects.length; i++) {
      xTargets.push(snapRects[i].x, snapRects[i].x + snapRects[i].width / 2, snapRects[i].x + snapRects[i].width);
      yTargets.push(snapRects[i].y, snapRects[i].y + snapRects[i].height / 2, snapRects[i].y + snapRects[i].height);
    }

    var xSnap = constrainedAxis === 'y' ? null : closestSnap(
      [rect.x, rect.x + rect.width / 2, rect.x + rect.width],
      xTargets,
      6 / editorScale / slideRect.width,
    );
    var ySnap = constrainedAxis === 'x' ? null : closestSnap(
      [rect.y, rect.y + rect.height / 2, rect.y + rect.height],
      yTargets,
      6 / editorScale / slideRect.height,
    );

    if (xSnap) {
      rect.x += xSnap.difference;
      showGuide(slide, 'x', xSnap.target);
    }

    if (ySnap) {
      rect.y += ySnap.difference;
      showGuide(slide, 'y', ySnap.target);
    }

    return clampRect(rect);
  }

  function ensureMarquee(slide) {
    if (marqueeElement) {
      return marqueeElement;
    }

    marqueeElement = document.createElement('div');
    marqueeElement.setAttribute('data-ark-editor-marquee', 'true');
    marqueeElement.style.position = 'absolute';
    marqueeElement.style.border = '1px dashed #2563eb';
    marqueeElement.style.background = 'rgba(37, 99, 235, 0.08)';
    marqueeElement.style.pointerEvents = 'none';
    marqueeElement.style.zIndex = '9999';
    getSlideCoordinateElement(slide).appendChild(marqueeElement);
    return marqueeElement;
  }

  function updateMarquee(startPoint, endPoint, slide) {
    var marquee = ensureMarquee(slide);
    var slideWidth = getSlideLogicalWidth(slide);
    var slideHeight = getSlideLogicalHeight(slide);
    var rect = clampRect({
      x: Math.min(startPoint.x, endPoint.x),
      y: Math.min(startPoint.y, endPoint.y),
      width: Math.abs(endPoint.x - startPoint.x),
      height: Math.abs(endPoint.y - startPoint.y),
    });

    marquee.style.left = rect.x * slideWidth + 'px';
    marquee.style.top = rect.y * slideHeight + 'px';
    marquee.style.width = rect.width * slideWidth + 'px';
    marquee.style.height = rect.height * slideHeight + 'px';

    return rect;
  }

  function finishTextBoxDraw(slide, startPoint, endPoint) {
    var rect = clampRect({
      x: Math.min(startPoint.x, endPoint.x),
      y: Math.min(startPoint.y, endPoint.y),
      width: Math.abs(endPoint.x - startPoint.x),
      height: Math.abs(endPoint.y - startPoint.y),
    });

    // clampRect floors both dimensions to MIN_BOX_SIZE, so a rect still at the
    // minimum on both axes means the pointer never dragged past the threshold:
    // treat it as a plain click and drop a default-sized box centered on the point.
    if (rect.width <= C.MIN_BOX_SIZE && rect.height <= C.MIN_BOX_SIZE) {
      rect = clampRect({
        x: endPoint.x - C.DEFAULT_BOX_WIDTH / 2,
        y: endPoint.y - C.DEFAULT_BOX_HEIGHT / 2,
        width: C.DEFAULT_BOX_WIDTH,
        height: C.DEFAULT_BOX_HEIGHT,
      });
    }

    postToParent({
      type: C.INSERT_REQUEST,
      kind: 'text-box',
      slideIndex: currentSlideIndex,
      geometry: rect,
    });
  }

  function onPointerMove(event) {
    if (!enabled || textEditElement) {
      return;
    }

    var slide = getActiveSlide();

    if (!slide) {
      return;
    }

    if (transformState && transformState.pointerId === event.pointerId) {
      if (transformState.kind === 'draw') {
        updateMarquee(transformState.startPoint, pointerToNormalized(event.clientX, event.clientY, slide), slide);
        return;
      }

      if (transformState.kind === 'move' && transformState.element) {
        var deltaX = pointerToNormalized(event.clientX, event.clientY, slide).x - transformState.startPoint.x;
        var deltaY = pointerToNormalized(event.clientX, event.clientY, slide).y - transformState.startPoint.y;
        var constrainedAxis = null;
        var startedMove = false;

        if (!transformState.started) {
          var slideRect = getSlideCoordinateRect(slide);

          if (
            Math.abs(deltaX * slideRect.width) < 2 / editorScale &&
            Math.abs(deltaY * slideRect.height) < 2 / editorScale
          ) {
            return;
          }

          if (transformState.adopted) {
            adoptMove(
              transformState.element,
              slide,
              transformState.startGeometry,
              transformState.logicalWidth,
              transformState.positionContext,
            );
          }

          transformState.started = true;
          startedMove = true;
        }

        if (event.shiftKey) {
          if (Math.abs(deltaX) >= Math.abs(deltaY)) {
            deltaY = 0;
            constrainedAxis = 'x';
          } else {
            deltaX = 0;
            constrainedAxis = 'y';
          }
        }

        var moved = snapMoveRect({
          x: transformState.startGeometry.x + deltaX,
          y: transformState.startGeometry.y + deltaY,
          width: transformState.startGeometry.width,
          height: transformState.startGeometry.height,
        }, transformState.snapRects, slide, event.altKey, constrainedAxis);
        transformState.lastGeometry = applyTransform(
          transformState.element,
          slide,
          moved,
          true,
          'move',
          transformState.adopted,
          transformState.positionContext,
        );
        if (startedMove && transformState.adopted) {
          var pendingTransformState = transformState;
          window.requestAnimationFrame(function () {
            if (transformState !== pendingTransformState || !pendingTransformState.lastGeometry) {
              return;
            }

            pendingTransformState.lastGeometry = applyTransform(
              pendingTransformState.element,
              slide,
              pendingTransformState.lastGeometry,
              true,
              'move',
              true,
              pendingTransformState.positionContext,
            );
            settleSlideRelativePosition(
              pendingTransformState.element,
              slide,
              pendingTransformState.lastGeometry,
              pendingTransformState.positionContext,
            );
            refreshSelectionChrome(
              pendingTransformState.element,
              slide,
              currentSlideIndex,
            );
          });
        }
        return;
      }

      if (transformState.kind === 'resize' && transformState.element && transformState.handle) {
        if (!transformState.started) {
          var resizePoint = pointerToNormalized(event.clientX, event.clientY, slide);
          var resizeDeltaX = resizePoint.x - transformState.startPoint.x;
          var resizeDeltaY = resizePoint.y - transformState.startPoint.y;
          var resizeSlideRect = getSlideCoordinateRect(slide);

          if (
            Math.abs(resizeDeltaX * resizeSlideRect.width) < 2 / editorScale &&
            Math.abs(resizeDeltaY * resizeSlideRect.height) < 2 / editorScale
          ) {
            return;
          }

          if (transformState.adopted) {
            adoptMove(
              transformState.element,
              slide,
              transformState.startGeometry,
              transformState.logicalWidth,
              transformState.positionContext,
            );
          }

          transformState.started = true;
        }

        var resized = resizeRectWithHandle(
          transformState.startGeometry,
          transformState.handle,
          event,
          slide,
          transformState.element,
        );
        transformState.lastGeometry = applyTransform(
          transformState.element,
          slide,
          resized,
          true,
          'resize',
          transformState.adopted,
          transformState.positionContext,
        );
        return;
      }
    }

    if (transformState) {
      return;
    }

    var target = findEditableTarget(event.target, slide);

    if (!setHoverCursor(target)) {
      return;
    }

    postToParent({
      type: C.HOVER,
      slideIndex: currentSlideIndex,
      elementId: target ? resolveElementId(target, slide, currentSlideIndex) : null,
      geometry: target ? normalizeRect(target, slide) : undefined,
      slideBounds: target ? normalizeSlideBounds(slide) : undefined,
      surface: target ? detectSurface(target, slide) : undefined,
    });
  }

  function captureTransformPointer(slide, pointerId) {
    if (typeof slide.setPointerCapture !== 'function') {
      return;
    }

    try {
      slide.setPointerCapture(pointerId);
    } catch (error) {
      // Pointer capture can fail if the pointer ended before the handler ran.
    }
  }

  function onPointerDown(event) {
    if (!enabled || textEditElement) {
      return;
    }

    var slide = getActiveSlide();

    if (!slide) {
      return;
    }

    finishNudge();

    if (currentTool === 'text') {
      event.preventDefault();
      event.stopPropagation();
      clearEditorOverlays();
      setSelectedElement(null, slide, currentSlideIndex);
      postSelection(null, slide, currentSlideIndex);
      transformState = {
        kind: 'draw',
        pointerId: event.pointerId,
        startPoint: pointerToNormalized(event.clientX, event.clientY, slide),
      };
      captureTransformPointer(slide, event.pointerId);
      ensureMarquee(slide);
      return;
    }

    if (currentTool !== 'select') {
      return;
    }

    var handle = findResizeHandle(event.target);

    if (handle && selectedElement && selectedElement.getAttribute(C.LOCKED_ATTR) !== 'true') {
      event.preventDefault();
      event.stopPropagation();
      // Defer adoption until the pointer moves past the click threshold so a
      // press-and-release on a handle does not persist position:absolute.
      var preparedResize = prepareMove(selectedElement, slide, false);
      transformState = {
        kind: 'resize',
        pointerId: event.pointerId,
        handle: handle,
        element: selectedElement,
        startPoint: pointerToNormalized(event.clientX, event.clientY, slide),
        startGeometry: preparedResize.geometry,
        snapshot: preparedResize.snapshot,
        adopted: preparedResize.adopted,
        logicalWidth: preparedResize.logicalWidth,
        positionContext: preparedResize.positionContext,
        started: false,
      };
      captureTransformPointer(slide, event.pointerId);
      return;
    }

    var target = findEditableTarget(event.target, slide);

    if (!target) {
      // Empty slide / non-editable chrome: deselect like PowerPoint.
      event.preventDefault();
      event.stopPropagation();
      setSelectedElement(null, slide, currentSlideIndex);
      postSelection(null, slide, currentSlideIndex);
      postToParent({
        type: C.HOVER,
        slideIndex: currentSlideIndex,
        elementId: null,
      });
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSelectedElement(target, slide, currentSlideIndex);
    postSelection(target, slide, currentSlideIndex);

    if (target.getAttribute(C.LOCKED_ATTR) !== 'true') {
      var prepared = prepareMove(target, slide, false);
      transformState = {
        kind: 'move',
        pointerId: event.pointerId,
        element: target,
        startPoint: pointerToNormalized(event.clientX, event.clientY, slide),
        startGeometry: prepared.geometry,
        snapshot: prepared.snapshot,
        adopted: prepared.adopted,
        logicalWidth: prepared.logicalWidth,
        positionContext: prepared.positionContext,
        started: false,
        snapRects: collectSnapRects(slide, target),
      };
      captureTransformPointer(slide, event.pointerId);
    }
  }

  function onPointerUp(event) {
    if (!enabled || !transformState || transformState.pointerId !== event.pointerId) {
      return;
    }

    var slide = getActiveSlide();

    if (!slide) {
      if (transformState.element) {
        restoreInlineStyle(transformState.element, transformState.snapshot);
      }

      transformState = null;
      clearEditorOverlays();
      return;
    }

    if (transformState.kind === 'draw') {
      var endPoint = pointerToNormalized(event.clientX, event.clientY, slide);
      finishTextBoxDraw(slide, transformState.startPoint, endPoint);
      clearMarquee();
      transformState = null;
      return;
    }

    if (
      (transformState.kind === 'move' || transformState.kind === 'resize') &&
      transformState.element
    ) {
      if (
        (transformState.kind === 'move' || transformState.kind === 'resize') &&
        !transformState.started
      ) {
        transformState = null;
        return;
      }

      var finalGeometry = transformState.lastGeometry || normalizeRect(transformState.element, slide);

      // Always emit a commit (even for a no-op drag) so the shell clears
      // transformPreview / isTransformingRef; empty patch ops are a no-op.
      applyTransform(
        transformState.element,
        slide,
        finalGeometry,
        false,
        transformState.kind,
        transformState.adopted,
        transformState.positionContext,
      );
      clearGuides();
      transformState = null;
      return;
    }

    transformState = null;
  }

  function onPointerCancel(event) {
    if (!transformState || transformState.pointerId !== event.pointerId) {
      return;
    }

    var slide = getActiveSlide();

    if (slide) {
      cancelTransform(slide);
      return;
    }

    if (transformState.element) {
      restoreInlineStyle(transformState.element, transformState.snapshot);
    }

    transformState = null;
    clearEditorOverlays();
    postToParent({ type: C.TRANSFORM_CANCEL });
  }

  function onPointerOut(event) {
    if (transformState && event.relatedTarget === null) {
      onPointerCancel({ pointerId: transformState.pointerId });
    }
  }

  function onDoubleClick(event) {
    if (!enabled || textEditElement) {
      return;
    }

    var slide = getActiveSlide();

    if (!slide) {
      return;
    }

    var target = findEditableTarget(event.target, slide);

    if (!target) {
      return;
    }

    var directTarget = event.target;

    if (
      !isTextBox(target) &&
      directTarget &&
      directTarget.nodeType === 1 &&
      isEditableCandidate(directTarget, slide)
    ) {
      target = directTarget;
    }

    var editableTarget = getTextEditTarget(target);
    var tag = editableTarget ? editableTarget.tagName.toLowerCase() : '';

    if (!editableTarget || (!isTextEditableTag(tag) && !isTextBox(target))) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSelectedElement(target, slide, currentSlideIndex);
    postSelection(target, slide, currentSlideIndex);
    startTextEditOnElement(target, slide, currentSlideIndex);
  }

  function finishNudge() {
    if (!nudgeState) {
      return;
    }

    window.clearTimeout(nudgeState.timer);
    var slide = getActiveSlide();

    if (slide && nudgeState.element) {
      applyTransform(
        nudgeState.element,
        slide,
        nudgeState.geometry || normalizeRect(nudgeState.element, slide),
        false,
        'move',
        nudgeState.adopted,
        nudgeState.positionContext,
      );
    }

    nudgeState = null;
  }

  function cancelNudge(slide) {
    if (!nudgeState) {
      return false;
    }

    var state = nudgeState;
    nudgeState = null;
    window.clearTimeout(state.timer);
    restoreInlineStyle(state.element, state.snapshot);
    clearGuides();
    postToParent({ type: C.TRANSFORM_CANCEL });

    if (slide) {
      refreshSelectionChrome(selectedElement, slide, currentSlideIndex);
    }

    return true;
  }

  function nudgeSelection(event, slide) {
    if (!selectedElement || selectedElement.getAttribute(C.LOCKED_ATTR) === 'true') {
      return false;
    }

    if (!nudgeState || nudgeState.element !== selectedElement) {
      finishNudge();
      var prepared = prepareMove(selectedElement, slide);
      nudgeState = {
        element: selectedElement,
        adopted: prepared.adopted,
        geometry: prepared.geometry,
        snapshot: prepared.snapshot,
        positionContext: prepared.positionContext,
        timer: null,
      };
    }

    var geometry = nudgeState.geometry || normalizeRect(selectedElement, slide);
    var slideWidth = getSlideLogicalWidth(slide);
    var slideHeight = getSlideLogicalHeight(slide);
    var amount = event.shiftKey ? 10 : 1;

    if (event.key === 'ArrowLeft') geometry.x -= amount / slideWidth;
    if (event.key === 'ArrowRight') geometry.x += amount / slideWidth;
    if (event.key === 'ArrowUp') geometry.y -= amount / slideHeight;
    if (event.key === 'ArrowDown') geometry.y += amount / slideHeight;

    nudgeState.geometry = applyTransform(
      selectedElement,
      slide,
      geometry,
      true,
      'move',
      nudgeState.adopted,
      nudgeState.positionContext,
    );
    if (nudgeState.adopted && !nudgeState.layoutCorrectionScheduled) {
      nudgeState.layoutCorrectionScheduled = true;
      var pendingNudgeState = nudgeState;
      window.requestAnimationFrame(function () {
        if (nudgeState !== pendingNudgeState || !pendingNudgeState.geometry) {
          return;
        }

        pendingNudgeState.geometry = applyTransform(
          pendingNudgeState.element,
          slide,
          pendingNudgeState.geometry,
          true,
          'move',
          true,
          pendingNudgeState.positionContext,
        );
        settleSlideRelativePosition(
          pendingNudgeState.element,
          slide,
          pendingNudgeState.geometry,
          pendingNudgeState.positionContext,
        );
        refreshSelectionChrome(pendingNudgeState.element, slide, currentSlideIndex);
      });
    }
    window.clearTimeout(nudgeState.timer);
    nudgeState.timer = window.setTimeout(finishNudge, 400);
    return true;
  }

  function cancelTransform(slide) {
    if (!transformState) {
      return false;
    }

    if (transformState.element) {
      restoreInlineStyle(transformState.element, transformState.snapshot);
    }

    transformState = null;
    clearMarquee();
    clearGuides();
    postToParent({ type: C.TRANSFORM_CANCEL });
    refreshSelectionChrome(selectedElement, slide, currentSlideIndex);
    return true;
  }

  function selectParent(slide) {
    var parent = selectedElement ? selectedElement.parentElement : null;

    while (parent && parent !== slide && !isEditableCandidate(parent, slide)) {
      parent = parent.parentElement;
    }

    var next = parent && parent !== slide ? parent : null;
    setSelectedElement(next, slide, currentSlideIndex);
    postSelection(next, slide, currentSlideIndex);
  }

  function onKeyDown(event) {
    if (textEditElement) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        endTextEdit(false);
        return;
      }

      if (
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown'
      ) {
        event.stopPropagation();
      }

      return;
    }

    if (!enabled || currentTool !== 'select') {
      return;
    }

    var shortcutKey = event.key.toLowerCase();

    if (event.metaKey || event.ctrlKey) {
      var action = null;

      if (shortcutKey === 'z') action = event.shiftKey ? 'redo' : 'undo';
      if (shortcutKey === 'y') action = 'redo';
      if (shortcutKey === 'd' && selectedElement) action = 'duplicate';

      if (action) {
        event.preventDefault();
        event.stopPropagation();

        if (action === 'undo' && cancelNudge(getActiveSlide())) {
          return;
        }

        finishNudge();
        postToParent({ type: C.SHORTCUT, action: action });
        return;
      }
    }

    var slide = getActiveSlide();

    if (event.key === 'Escape' && slide) {
      event.preventDefault();
      event.stopPropagation();

      if (cancelNudge(slide)) {
        return;
      }

      if (!cancelTransform(slide)) {
        selectParent(slide);
      }

      return;
    }

    if (
      slide &&
      (event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown') &&
      nudgeSelection(event, slide)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedElement) {
      if (selectedElement.getAttribute(C.LOCKED_ATTR) === 'true') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      finishNudge();
      postToParent({
        type: C.DELETE_REQUEST,
        elementId: resolveElementId(selectedElement, getActiveSlide(), currentSlideIndex),
        slideIndex: currentSlideIndex,
      });
    }
  }

  function bindListeners() {
    if (listenersBound) {
      return;
    }

    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('lostpointercapture', onPointerCancel, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('dblclick', onDoubleClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    listenersBound = true;
  }

  function unbindListeners() {
    if (!listenersBound) {
      return;
    }

    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerCancel, true);
    document.removeEventListener('lostpointercapture', onPointerCancel, true);
    document.removeEventListener('pointerout', onPointerOut, true);
    document.removeEventListener('dblclick', onDoubleClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    listenersBound = false;
  }

  function enableEditor(slideIndex, tool, scale) {
    finishNudge();
    var previousSlide = getActiveSlide();

    if (transformState) {
      if (previousSlide) {
        cancelTransform(previousSlide);
      } else {
        if (transformState.element) {
          restoreInlineStyle(transformState.element, transformState.snapshot);
        }

        transformState = null;
        clearEditorOverlays();
      }
    }

    enabled = true;
    currentSlideIndex = slideIndex;
    currentTool = tool || 'select';
    editorScale = Number.isFinite(scale) && scale > 0 ? scale : editorScale;
    ensureEditorStyle();
    bindListeners();
    postToParent({
      type: C.READY,
      slideIndex: currentSlideIndex,
      protocolVersion: C.PROTOCOL_VERSION,
    });
  }

  function disableEditor() {
    enabled = false;

    if (transformState && transformState.element) {
      restoreInlineStyle(transformState.element, transformState.snapshot);
    }

    transformState = null;
    window.clearTimeout(nudgeState && nudgeState.timer);

    if (nudgeState && nudgeState.element) {
      restoreInlineStyle(nudgeState.element, nudgeState.snapshot);
    }

    nudgeState = null;
    endTextEdit(false);
    clearSelectionStyles();
    clearEditorOverlays();
    clearHoverCursor();
    selectedElement = null;
    unbindListeners();
    postToParent({ type: C.SELECTION_CHANGE, selection: null });
    postToParent({ type: C.HOVER, slideIndex: currentSlideIndex, elementId: null });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) {
      return;
    }

    if (C.PARENT_ORIGIN && event.origin !== C.PARENT_ORIGIN) {
      return;
    }

    var data = event.data;

    if (!isRecord(data) || typeof data.type !== 'string' || data.type.indexOf('ark:editor-') !== 0) {
      return;
    }

    try {
      if (data.type === C.ENABLE && typeof data.slideIndex === 'number') {
        enableEditor(data.slideIndex, data.tool, data.scale);
        return;
      }

      if (data.type === C.CONFIGURE && Number.isFinite(data.scale) && data.scale > 0) {
        editorScale = data.scale;

        if (enabled && selectedElement) {
          var configuredSlide = getActiveSlide();

          if (configuredSlide) {
            updateResizeHandles(selectedElement, configuredSlide);
          }
        }

        return;
      }

      if (data.type === C.DISABLE) {
        disableEditor();
        return;
      }

      if (!enabled) {
        return;
      }

      if (data.type === C.TRANSFORM_CANCEL) {
        cancelTransform(getActiveSlide());
        return;
      }

      if (data.type === C.CLEAR_SELECTION) {
        var clearSlide = getActiveSlide();

        if (!clearSlide) {
          postError('No active slide found for editor command.', 'missing-slide');
          return;
        }

        setSelectedElement(null, clearSlide, currentSlideIndex);
        postSelection(null, clearSlide, currentSlideIndex);
        return;
      }

      if (data.type === C.SET_TOOL && (data.tool === 'select' || data.tool === 'text' || data.tool === 'insert')) {
        currentTool = data.tool;
        var toolSlide = getActiveSlide();

        if (toolSlide) {
          cancelTransform(toolSlide);
        }

        clearEditorOverlays();
        return;
      }

      if (
        (data.type === C.SELECT ||
          data.type === C.REQUEST_GEOMETRY ||
          data.type === C.START_TEXT_EDIT) &&
        typeof data.elementId === 'string' &&
        typeof data.slideIndex === 'number'
      ) {
        // Update the active slide index before resolving the slide so geometry
        // and selection target the requested slide during rapid navigation.
        currentSlideIndex = data.slideIndex;
        var slide = getActiveSlide();

        if (!slide) {
          postError('No active slide found for editor command.', 'missing-slide');
          return;
        }

        var element = findElementById(data.elementId, slide, data.slideIndex);

        if (!element) {
          postError('Element "' + data.elementId + '" was not found.', 'missing-element');
          return;
        }

        if (data.type === C.SELECT) {
          setSelectedElement(element, slide, data.slideIndex);
          postSelection(element, slide, data.slideIndex);
          return;
        }

        if (data.type === C.REQUEST_GEOMETRY) {
          postGeometryForElement(element, slide, data.slideIndex);
          return;
        }

        if (data.type === C.START_TEXT_EDIT) {
          startTextEditOnElement(element, slide, data.slideIndex);
          return;
        }
      }

      if (data.type === C.CANCEL_TEXT_EDIT) {
        endTextEdit(false);
        return;
      }
    } catch (error) {
      postError(error && error.message ? error.message : String(error), 'editor-runtime');
    }
  });

  document.addEventListener(
    'focusout',
    function (event) {
      if (!textEditElement || event.target !== textEditElement) {
        return;
      }

      endTextEdit(true);
    },
    true,
  );
})();`
}
