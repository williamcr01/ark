/**
 * Wire identifiers for the editor bridge protocol: every message type the shell and
 * the injected runtime exchange, grouped by direction.
 *
 * @see docs/deck-editor-bridge.md
 */

import type { EditorShortcutAction, EditorSurface, EditorTool } from './types.ts'

export const EDITOR_BRIDGE_PROTOCOL_VERSION = 1 as const
export const EDITOR_SESSION_HANDOFF_KEY = '__arkEditorSessionV1' as const

export const EDITOR_CONNECT_MESSAGE_TYPE = 'ark:editor-connect' as const
export const EDITOR_CONNECT_ACK_MESSAGE_TYPE = 'ark:editor-connect-ack' as const

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
/** Parent observed pointer release — commit if the gesture started, else clear. */
export const EDITOR_TRANSFORM_END_MESSAGE_TYPE = 'ark:editor-transform-end' as const
/** Stamp a stable data-ark-id onto a live element after a successful live patch. */
export const EDITOR_ASSIGN_ID_MESSAGE_TYPE = 'ark:editor-assign-id' as const
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
  EDITOR_TRANSFORM_END_MESSAGE_TYPE,
  EDITOR_ASSIGN_ID_MESSAGE_TYPE,
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

export const EDITOR_MESSAGE_TYPE_SET = new Set<string>(EDITOR_MESSAGE_TYPES)
export const EDITOR_TOOL_SET = new Set<EditorTool>(['select', 'text', 'insert'])
export const EDITOR_SURFACE_SET = new Set<EditorSurface>(['light', 'dark'])
export const EDITOR_SHORTCUT_ACTION_SET = new Set<EditorShortcutAction>([
  'undo',
  'redo',
  'duplicate',
])
