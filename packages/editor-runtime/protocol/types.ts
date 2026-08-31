/**
 * The shape of every editor bridge message, plus the selection and geometry payloads
 * they carry.
 */

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
import type { NormalizedRect as EditorNormalizedRect } from '@ark/deck/document/geometry.ts'

export type { EditorNormalizedRect }

/** Cap for canvas multi-select (issue #248). Enforced in the runtime and protocol guard. */
export const MAX_EDITOR_SELECTIONS = 32

export type EditorTool = 'select' | 'text' | 'insert'
export type EditorSurface = 'light' | 'dark'
export type EditorShortcutAction = 'undo' | 'redo' | 'duplicate'

/** Local CSS-px flow footprint preserved when adopting an in-flow element. */
export type EditorAdoptSpacer = {
  width: number
  height: number
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
  display: string
}

export type EditorImageFitMode = 'contain' | 'cover' | 'fill'

export type EditorConnectMessage = {
  type: typeof EDITOR_CONNECT_MESSAGE_TYPE
  handshake: string
  protocolVersion: typeof EDITOR_BRIDGE_PROTOCOL_VERSION
}

export type EditorConnectAckMessage = {
  type: typeof EDITOR_CONNECT_ACK_MESSAGE_TYPE
  protocolVersion: typeof EDITOR_BRIDGE_PROTOCOL_VERSION
}

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
  /** Primary / last-interacted selection for inspector and text edit; null if empty. */
  selection: EditorSelectionInfo | null
  /** Full same-slide selection set. Omit or empty when none. Capped at MAX_EDITOR_SELECTIONS. */
  selections?: EditorSelectionInfo[]
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

/** Geometry persist payload for one companion in a multi-element transform commit. */
export type EditorTransformCompanion = {
  elementId: string
  slideIndex: number
  geometry: EditorNormalizedRect
  zIndex?: number | null
  slideBounds?: EditorNormalizedRect
  adopted?: true
  cssX?: number
  cssY?: number
  cssWidth?: number
  cssHeight?: number
  slideWidth?: number
  slideHeight?: number
  spacer?: EditorAdoptSpacer
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
  /** Flow footprint to persist as an inert spacer when this commit adopted the element. */
  spacer?: EditorAdoptSpacer
  /** Other unlocked selected elements moved in the same gesture (issue #248). */
  companions?: EditorTransformCompanion[]
}

export type EditorTransformCancelMessage = {
  type: typeof EDITOR_TRANSFORM_CANCEL_MESSAGE_TYPE
}

export type EditorTransformEndMessage = {
  type: typeof EDITOR_TRANSFORM_END_MESSAGE_TYPE
}

export type EditorAssignIdMessage = {
  type: typeof EDITOR_ASSIGN_ID_MESSAGE_TYPE
  fromElementId: string
  toElementId: string
  slideIndex: number
  /** When true, also stamp data-ark-managed="true" (adopted layout). */
  managed?: boolean
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
  | EditorTransformEndMessage
  | EditorAssignIdMessage

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
