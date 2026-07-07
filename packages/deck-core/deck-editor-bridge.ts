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
  TRANSIENT_ELEMENT_ID_PREFIX,
} from './deck-metadata.ts'
import { DECK_BRIDGE_POST_MESSAGE_TARGET } from '@ark/runtime-registry/sandbox-origin.ts'

export const EDITOR_BRIDGE_PROTOCOL_VERSION = 1 as const

export const EDITOR_ENABLE_MESSAGE_TYPE = 'ark:editor-enable' as const
export const EDITOR_DISABLE_MESSAGE_TYPE = 'ark:editor-disable' as const
export const EDITOR_SELECT_MESSAGE_TYPE = 'ark:editor-select' as const
export const EDITOR_CLEAR_SELECTION_MESSAGE_TYPE = 'ark:editor-clear-selection' as const
export const EDITOR_START_TEXT_EDIT_MESSAGE_TYPE = 'ark:editor-start-text-edit' as const
export const EDITOR_CANCEL_TEXT_EDIT_MESSAGE_TYPE = 'ark:editor-cancel-text-edit' as const
export const EDITOR_REQUEST_GEOMETRY_MESSAGE_TYPE = 'ark:editor-request-geometry' as const
export const EDITOR_SET_TOOL_MESSAGE_TYPE = 'ark:editor-set-tool' as const

export const EDITOR_READY_MESSAGE_TYPE = 'ark:editor-ready' as const
export const EDITOR_HOVER_MESSAGE_TYPE = 'ark:editor-hover' as const
export const EDITOR_SELECTION_CHANGE_MESSAGE_TYPE = 'ark:editor-selection-change' as const
export const EDITOR_GEOMETRY_MESSAGE_TYPE = 'ark:editor-geometry' as const
export const EDITOR_TEXT_COMMIT_MESSAGE_TYPE = 'ark:editor-text-commit' as const
export const EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE = 'ark:editor-text-edit-state' as const
export const EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE = 'ark:editor-transform-preview' as const
export const EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE = 'ark:editor-transform-commit' as const
export const EDITOR_DELETE_REQUEST_MESSAGE_TYPE = 'ark:editor-delete-request' as const
export const EDITOR_INSERT_REQUEST_MESSAGE_TYPE = 'ark:editor-insert-request' as const
export const EDITOR_ERROR_MESSAGE_TYPE = 'ark:editor-error' as const

export const EDITOR_SHELL_MESSAGE_TYPES = [
  EDITOR_ENABLE_MESSAGE_TYPE,
  EDITOR_DISABLE_MESSAGE_TYPE,
  EDITOR_SELECT_MESSAGE_TYPE,
  EDITOR_CLEAR_SELECTION_MESSAGE_TYPE,
  EDITOR_START_TEXT_EDIT_MESSAGE_TYPE,
  EDITOR_CANCEL_TEXT_EDIT_MESSAGE_TYPE,
  EDITOR_REQUEST_GEOMETRY_MESSAGE_TYPE,
  EDITOR_SET_TOOL_MESSAGE_TYPE,
] as const

export const EDITOR_RUNTIME_MESSAGE_TYPES = [
  EDITOR_READY_MESSAGE_TYPE,
  EDITOR_HOVER_MESSAGE_TYPE,
  EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
  EDITOR_GEOMETRY_MESSAGE_TYPE,
  EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
  EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
  EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
  EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
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

export type EditorNormalizedRect = {
  x: number
  y: number
  width: number
  height: number
}

export type EditorImageFitMode = 'contain' | 'cover' | 'fill'

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
}

export type EditorEnableMessage = {
  type: typeof EDITOR_ENABLE_MESSAGE_TYPE
  slideIndex: number
  tool?: EditorTool
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
}

export type EditorTransformCommitMessage = {
  type: typeof EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE
  elementId: string
  slideIndex: number
  geometry: EditorNormalizedRect
  zIndex?: number | null
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
  | EditorDisableMessage
  | EditorSelectMessage
  | EditorClearSelectionMessage
  | EditorStartTextEditMessage
  | EditorCancelTextEditMessage
  | EditorRequestGeometryMessage
  | EditorSetToolMessage

export type EditorRuntimeMessage =
  | EditorReadyMessage
  | EditorHoverMessage
  | EditorSelectionChangeMessage
  | EditorGeometryMessage
  | EditorTextCommitMessage
  | EditorTextEditStateMessage
  | EditorTransformPreviewMessage
  | EditorTransformCommitMessage
  | EditorDeleteRequestMessage
  | EditorInsertRequestMessage
  | EditorErrorMessage

export type EditorMessage = EditorShellMessage | EditorRuntimeMessage

const EDITOR_MESSAGE_TYPE_SET = new Set<string>(EDITOR_MESSAGE_TYPES)
const EDITOR_TOOL_SET = new Set<EditorTool>(['select', 'text', 'insert'])

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
    (value.imageFit === undefined ||
      value.imageFit === null ||
      value.imageFit === 'contain' ||
      value.imageFit === 'cover' ||
      value.imageFit === 'fill')
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
    (value.tool === undefined || isEditorTool(value.tool))
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
      (typeof value.elementId === 'string' && value.elementId.length > 0))
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
    (value.zIndex === null || isFiniteNumber(value.zIndex))
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
    (value.zIndex === undefined || value.zIndex === null || isFiniteNumber(value.zIndex))
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
    (value.zIndex === undefined || value.zIndex === null || isFiniteNumber(value.zIndex))
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
    isEditorDisableMessage(value) ||
    isEditorSelectMessage(value) ||
    isEditorClearSelectionMessage(value) ||
    isEditorStartTextEditMessage(value) ||
    isEditorCancelTextEditMessage(value) ||
    isEditorRequestGeometryMessage(value) ||
    isEditorSetToolMessage(value)
  )
}

export function isEditorRuntimeMessage(value: unknown): value is EditorRuntimeMessage {
  return (
    isEditorReadyMessage(value) ||
    isEditorHoverMessage(value) ||
    isEditorSelectionChangeMessage(value) ||
    isEditorGeometryMessage(value) ||
    isEditorTextCommitMessage(value) ||
    isEditorTextEditStateMessage(value) ||
    isEditorTransformPreviewMessage(value) ||
    isEditorTransformCommitMessage(value) ||
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
): EditorEnableMessage {
  return { type: EDITOR_ENABLE_MESSAGE_TYPE, slideIndex, tool }
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
): EditorHoverMessage {
  return { type: EDITOR_HOVER_MESSAGE_TYPE, slideIndex, elementId }
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
): EditorGeometryMessage {
  return { type: EDITOR_GEOMETRY_MESSAGE_TYPE, elementId, slideIndex, geometry, zIndex }
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
): EditorTransformPreviewMessage {
  return {
    type: EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
    elementId,
    slideIndex,
    geometry,
    ...(zIndex !== undefined ? { zIndex } : {}),
  }
}

export function createEditorTransformCommitMessage(
  elementId: string,
  slideIndex: number,
  geometry: EditorNormalizedRect,
  zIndex?: number | null,
): EditorTransformCommitMessage {
  return {
    type: EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
    elementId,
    slideIndex,
    geometry,
    ...(zIndex !== undefined ? { zIndex } : {}),
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
    DISABLE: EDITOR_DISABLE_MESSAGE_TYPE,
    SELECT: EDITOR_SELECT_MESSAGE_TYPE,
    CLEAR_SELECTION: EDITOR_CLEAR_SELECTION_MESSAGE_TYPE,
    START_TEXT_EDIT: EDITOR_START_TEXT_EDIT_MESSAGE_TYPE,
    CANCEL_TEXT_EDIT: EDITOR_CANCEL_TEXT_EDIT_MESSAGE_TYPE,
    REQUEST_GEOMETRY: EDITOR_REQUEST_GEOMETRY_MESSAGE_TYPE,
    SET_TOOL: EDITOR_SET_TOOL_MESSAGE_TYPE,
    READY: EDITOR_READY_MESSAGE_TYPE,
    HOVER: EDITOR_HOVER_MESSAGE_TYPE,
    SELECTION_CHANGE: EDITOR_SELECTION_CHANGE_MESSAGE_TYPE,
    GEOMETRY: EDITOR_GEOMETRY_MESSAGE_TYPE,
    TEXT_COMMIT: EDITOR_TEXT_COMMIT_MESSAGE_TYPE,
    TEXT_EDIT_STATE: EDITOR_TEXT_EDIT_STATE_MESSAGE_TYPE,
    TRANSFORM_PREVIEW: EDITOR_TRANSFORM_PREVIEW_MESSAGE_TYPE,
    TRANSFORM_COMMIT: EDITOR_TRANSFORM_COMMIT_MESSAGE_TYPE,
    DELETE_REQUEST: EDITOR_DELETE_REQUEST_MESSAGE_TYPE,
    INSERT_REQUEST: EDITOR_INSERT_REQUEST_MESSAGE_TYPE,
    ERROR: EDITOR_ERROR_MESSAGE_TYPE,
    SELECTORS: [...options.slideSelectors],
    PARENT_ORIGIN: options.parentOrigin?.trim() || '',
    ELEMENT_ID_ATTR: ARK_ELEMENT_ID_ATTR,
    LOCKED_ATTR: ARK_LOCKED_ATTR,
    MANAGED_ATTR: 'data-ark-managed',
    EDITABLE_ATTR: 'data-ark-editable',
    TRANSIENT_PREFIX: TRANSIENT_ELEMENT_ID_PREFIX,
    INLINE_TEXT_TAGS: [...INLINE_TEXT_EDITABLE_TAGS],
    TEXT_BOX_EDITABLE: ARK_TEXT_BOX_EDITABLE_VALUE,
    TEXT_BOX_CLASS: ARK_TEXT_BOX_CLASS,
    MIN_BOX_SIZE: MIN_TEXT_BOX_NORMALIZED_SIZE,
    DEFAULT_BOX_WIDTH: DEFAULT_TEXT_BOX_NORMALIZED_SIZE.width,
    DEFAULT_BOX_HEIGHT: DEFAULT_TEXT_BOX_NORMALIZED_SIZE.height,
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
  var marqueeElement = null;
  var resizeHandles = [];

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
      tag === 'svg'
    );
  }

  function findEditableTarget(node, slide) {
    var current = node;

    while (current && current !== slide) {
      if (current.nodeType === 1 && isEditableCandidate(current, slide)) {
        return current;
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
    };
  }

  function normalizeRect(element, slide) {
    var slideRect = slide.getBoundingClientRect();
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
    var slideRect = slide.getBoundingClientRect();

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

    return (
      element.tagName.toLowerCase() === 'img' ||
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
    var slideRect = slide.getBoundingClientRect();

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

    return element.getAttribute(C.MANAGED_ATTR) === 'true' || isTextBox(element);
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

  function clearEditorOverlays() {
    clearMarquee();
    clearResizeHandles();
  }

  function updateResizeHandles(element, slide) {
    clearResizeHandles();

    if (!element || !slide || !isManagedElement(element) || element.getAttribute(C.LOCKED_ATTR) === 'true') {
      return;
    }

    var rect = normalizeRect(element, slide);
    var handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    for (var i = 0; i < handles.length; i++) {
      var handle = document.createElement('div');
      handle.setAttribute('data-ark-editor-handle', handles[i]);
      handle.style.position = 'absolute';
      handle.style.width = '8px';
      handle.style.height = '8px';
      handle.style.background = '#2563eb';
      handle.style.border = '1px solid #ffffff';
      handle.style.borderRadius = '2px';
      handle.style.zIndex = '10000';
      handle.style.pointerEvents = 'auto';
      handle.style.boxSizing = 'border-box';
      positionResizeHandle(handle, handles[i], rect, slide);
      slide.appendChild(handle);
      resizeHandles.push(handle);
    }
  }

  function positionResizeHandle(handle, kind, rect, slide) {
    var slideRect = slide.getBoundingClientRect();
    var left = rect.x * slideRect.width;
    var top = rect.y * slideRect.height;
    var width = rect.width * slideRect.width;
    var height = rect.height * slideRect.height;
    var size = 8;

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

  function applyTransform(element, slide, geometry, preview, mode) {
    var slideRect = slide.getBoundingClientRect();
    var rect = clampRect(geometry);

    if (!slideRect.width || !slideRect.height) {
      return rect;
    }

    element.style.position = 'absolute';
    element.style.left = rect.x * slideRect.width + 'px';
    element.style.top = rect.y * slideRect.height + 'px';

    // A pure move must not touch the element size. Only rewrite width/height
    // during a resize, otherwise elements sized with an explicit height would
    // silently change dimensions when merely repositioned.
    if (mode !== 'move') {
      element.style.width = rect.width * slideRect.width + 'px';

      if (isImageElement(element)) {
        element.style.height = rect.height * slideRect.height + 'px';
        element.style.minHeight = '';
      } else {
        element.style.minHeight = rect.height * slideRect.height + 'px';
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
      });
    } else {
      postToParent({
        type: C.TRANSFORM_COMMIT,
        elementId: resolveElementId(element, slide, currentSlideIndex),
        slideIndex: currentSlideIndex,
        geometry: rect,
        zIndex: readZIndex(element),
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

    if (element && isImageElement(element)) {
      var aspectRatio = getImageAspectRatio(element);
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
    slide.appendChild(marqueeElement);
    return marqueeElement;
  }

  function updateMarquee(startPoint, endPoint, slide) {
    var marquee = ensureMarquee(slide);
    var slideRect = slide.getBoundingClientRect();
    var rect = clampRect({
      x: Math.min(startPoint.x, endPoint.x),
      y: Math.min(startPoint.y, endPoint.y),
      width: Math.abs(endPoint.x - startPoint.x),
      height: Math.abs(endPoint.y - startPoint.y),
    });

    marquee.style.left = rect.x * slideRect.width + 'px';
    marquee.style.top = rect.y * slideRect.height + 'px';
    marquee.style.width = rect.width * slideRect.width + 'px';
    marquee.style.height = rect.height * slideRect.height + 'px';

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
        var moved = clampRect({
          x: transformState.startGeometry.x + deltaX,
          y: transformState.startGeometry.y + deltaY,
          width: transformState.startGeometry.width,
          height: transformState.startGeometry.height,
        });
        applyTransform(transformState.element, slide, moved, true, 'move');
        return;
      }

      if (transformState.kind === 'resize' && transformState.element && transformState.handle) {
        var resized = resizeRectWithHandle(
          transformState.startGeometry,
          transformState.handle,
          event,
          slide,
          transformState.element,
        );
        applyTransform(transformState.element, slide, resized, true, 'resize');
        return;
      }
    }

    if (transformState) {
      return;
    }

    var target = findEditableTarget(event.target, slide);

    postToParent({
      type: C.HOVER,
      slideIndex: currentSlideIndex,
      elementId: target ? resolveElementId(target, slide, currentSlideIndex) : null,
    });
  }

  function onPointerDown(event) {
    if (!enabled || textEditElement) {
      return;
    }

    var slide = getActiveSlide();

    if (!slide) {
      return;
    }

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
      ensureMarquee(slide);
      return;
    }

    if (currentTool !== 'select') {
      return;
    }

    var handle = findResizeHandle(event.target);

    if (handle && selectedElement && isManagedElement(selectedElement)) {
      event.preventDefault();
      event.stopPropagation();
      transformState = {
        kind: 'resize',
        pointerId: event.pointerId,
        handle: handle,
        element: selectedElement,
        startGeometry: normalizeRect(selectedElement, slide),
      };
      return;
    }

    var target = findEditableTarget(event.target, slide);

    if (!target) {
      setSelectedElement(null, slide, currentSlideIndex);
      postSelection(null, slide, currentSlideIndex);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSelectedElement(target, slide, currentSlideIndex);
    postSelection(target, slide, currentSlideIndex);

    if (isManagedElement(target) && target.getAttribute(C.LOCKED_ATTR) !== 'true') {
      transformState = {
        kind: 'move',
        pointerId: event.pointerId,
        element: target,
        startPoint: pointerToNormalized(event.clientX, event.clientY, slide),
        startGeometry: normalizeRect(target, slide),
      };
    }
  }

  function onPointerUp(event) {
    if (!enabled || !transformState || transformState.pointerId !== event.pointerId) {
      return;
    }

    var slide = getActiveSlide();

    if (!slide) {
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
      var finalGeometry = normalizeRect(transformState.element, slide);
      applyTransform(transformState.element, slide, finalGeometry, false, transformState.kind);
      transformState = null;
      return;
    }

    transformState = null;
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

    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedElement) {
      // Only Ark-managed elements (text boxes, duplicated/moved elements) can be
      // deleted with the keyboard. Deck-authored headings/paragraphs stay put so
      // a stray Backspace can't destroy the original content.
      if (!isManagedElement(selectedElement)) {
        return;
      }

      if (selectedElement.getAttribute(C.LOCKED_ATTR) === 'true') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
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
    document.removeEventListener('dblclick', onDoubleClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    listenersBound = false;
  }

  function enableEditor(slideIndex, tool) {
    enabled = true;
    currentSlideIndex = slideIndex;
    currentTool = tool || 'select';
    transformState = null;
    bindListeners();
    postToParent({
      type: C.READY,
      slideIndex: currentSlideIndex,
      protocolVersion: C.PROTOCOL_VERSION,
    });
  }

  function disableEditor() {
    enabled = false;
    transformState = null;
    endTextEdit(false);
    clearSelectionStyles();
    clearEditorOverlays();
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
        enableEditor(data.slideIndex, data.tool);
        return;
      }

      if (data.type === C.DISABLE) {
        disableEditor();
        return;
      }

      if (!enabled) {
        return;
      }

      var slide = getActiveSlide();

      if (!slide) {
        postError('No active slide found for editor command.', 'missing-slide');
        return;
      }

      if (data.type === C.CLEAR_SELECTION) {
        setSelectedElement(null, slide, currentSlideIndex);
        postSelection(null, slide, currentSlideIndex);
        return;
      }

      if (data.type === C.SET_TOOL && (data.tool === 'select' || data.tool === 'text' || data.tool === 'insert')) {
        currentTool = data.tool;
        clearEditorOverlays();
        transformState = null;
        return;
      }

      if (
        (data.type === C.SELECT ||
          data.type === C.REQUEST_GEOMETRY ||
          data.type === C.START_TEXT_EDIT) &&
        typeof data.elementId === 'string' &&
        typeof data.slideIndex === 'number'
      ) {
        currentSlideIndex = data.slideIndex;
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
