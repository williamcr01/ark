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
  ARK_ELEMENT_ID_ATTR,
  ARK_LOCKED_ATTR,
  TRANSIENT_ELEMENT_ID_PREFIX,
} from './deck-metadata.ts'
import { DECK_BRIDGE_POST_MESSAGE_TARGET } from './sandbox-origin.ts'

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

export type EditorSelectionInfo = {
  elementId: string
  slideIndex: number
  slideId: string | null
  tagName: string
  locked: boolean
  textPreview: string | null
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
    (value.textPreview === null || typeof value.textPreview === 'string')
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
    ERROR: EDITOR_ERROR_MESSAGE_TYPE,
    SELECTORS: [...options.slideSelectors],
    PARENT_ORIGIN: options.parentOrigin?.trim() || '',
    ELEMENT_ID_ATTR: ARK_ELEMENT_ID_ATTR,
    LOCKED_ATTR: ARK_LOCKED_ATTR,
    TRANSIENT_PREFIX: TRANSIENT_ELEMENT_ID_PREFIX,
    INLINE_TEXT_TAGS: [...INLINE_TEXT_EDITABLE_TAGS],
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

  function buildSelection(element, slide, slideIndex) {
    return {
      elementId: resolveElementId(element, slide, slideIndex),
      slideIndex: slideIndex,
      slideId: slide.getAttribute('data-ark-slide-id') || null,
      tagName: element.tagName.toLowerCase(),
      locked: element.getAttribute(C.LOCKED_ATTR) === 'true',
      textPreview: readTextPreview(element),
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

  function clearSelectionStyles() {
    if (selectedElement) {
      selectedElement.removeAttribute('data-ark-editor-selected');
    }

    selectedElement = null;
  }

  function setSelectedElement(element) {
    clearSelectionStyles();
    selectedElement = element;

    if (selectedElement) {
      selectedElement.setAttribute('data-ark-editor-selected', '');
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
    if (element.getAttribute(C.LOCKED_ATTR) === 'true') {
      postError('Element is locked.', 'locked-element');
      return;
    }

    var tag = element.tagName.toLowerCase();

    if (!isTextEditableTag(tag)) {
      postError('Element is not text-editable.', 'non-text-element');
      return;
    }

    endTextEdit(false);
    textEditElement = element;
    originalTextBeforeEdit = element.textContent || '';
    element.setAttribute('contenteditable', 'true');
    element.setAttribute('data-ark-editor-text-edit', '');
    element.focus();

    try {
      var selection = window.getSelection();

      if (selection) {
        var range = document.createRange();
        range.selectNodeContents(element);
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

  function applyTransform(element, slide, geometry, preview) {
    var slideRect = slide.getBoundingClientRect();

    if (!slideRect.width || !slideRect.height) {
      return;
    }

    element.style.position = 'absolute';
    element.style.left = geometry.x * slideRect.width + 'px';
    element.style.top = geometry.y * slideRect.height + 'px';
    element.style.width = geometry.width * slideRect.width + 'px';
    element.style.height = geometry.height * slideRect.height + 'px';

    if (!preview) {
      postToParent({
        type: C.TRANSFORM_COMMIT,
        elementId: resolveElementId(element, slide, currentSlideIndex),
        slideIndex: currentSlideIndex,
        geometry: geometry,
        zIndex: readZIndex(element),
      });
    }
  }

  function onPointerMove(event) {
    if (!enabled || textEditElement) {
      return;
    }

    var slide = getActiveSlide();

    if (!slide) {
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
    if (!enabled || currentTool !== 'select' || textEditElement) {
      return;
    }

    var slide = getActiveSlide();

    if (!slide) {
      return;
    }

    var target = findEditableTarget(event.target, slide);

    if (!target) {
      setSelectedElement(null);
      postSelection(null, slide, currentSlideIndex);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSelectedElement(target);
    postSelection(target, slide, currentSlideIndex);
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

    if (!target || !isTextEditableTag(target.tagName.toLowerCase())) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSelectedElement(target);
    postSelection(target, slide, currentSlideIndex);
    startTextEditOnElement(target, slide, currentSlideIndex);
  }

  function onKeyDown(event) {
    if (!textEditElement) {
      return;
    }

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
  }

  function bindListeners() {
    if (listenersBound) {
      return;
    }

    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerdown', onPointerDown, true);
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
    document.removeEventListener('dblclick', onDoubleClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    listenersBound = false;
  }

  function enableEditor(slideIndex, tool) {
    enabled = true;
    currentSlideIndex = slideIndex;
    currentTool = tool || 'select';
    bindListeners();
    postToParent({
      type: C.READY,
      slideIndex: currentSlideIndex,
      protocolVersion: C.PROTOCOL_VERSION,
    });
  }

  function disableEditor() {
    enabled = false;
    endTextEdit(false);
    clearSelectionStyles();
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
        setSelectedElement(null);
        postSelection(null, slide, currentSlideIndex);
        return;
      }

      if (data.type === C.SET_TOOL && (data.tool === 'select' || data.tool === 'text' || data.tool === 'insert')) {
        currentTool = data.tool;
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
          setSelectedElement(element);
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
