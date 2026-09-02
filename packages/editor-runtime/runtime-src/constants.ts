export type RuntimeConstants = {
  PROTOCOL_VERSION: number
  CONNECT: string
  CONNECT_ACK: string
  SESSION_HANDOFF_KEY: string
  ENABLE: string
  CONFIGURE: string
  DISABLE: string
  SELECT: string
  CLEAR_SELECTION: string
  START_TEXT_EDIT: string
  CANCEL_TEXT_EDIT: string
  REQUEST_GEOMETRY: string
  SET_TOOL: string
  READY: string
  SHORTCUT: string
  HOVER: string
  SELECTION_CHANGE: string
  GEOMETRY: string
  TEXT_COMMIT: string
  TEXT_EDIT_STATE: string
  TRANSFORM_PREVIEW: string
  TRANSFORM_COMMIT: string
  TRANSFORM_CANCEL: string
  TRANSFORM_END: string
  ASSIGN_ID: string
  DELETE_REQUEST: string
  INSERT_REQUEST: string
  ERROR: string
  SELECTORS: string[]
  PARENT_ORIGIN: string
  ELEMENT_ID_ATTR: string
  LOCKED_ATTR: string
  MANAGED_ATTR: string
  SPACER_ATTR: string
  SPACER_FOR_ATTR: string
  EDITABLE_ATTR: string
  ROLE_ATTR: string
  TRANSIENT_PREFIX: string
  INLINE_TEXT_TAGS: string[]
  TEXT_BOX_EDITABLE: string
  TEXT_BOX_CLASS: string
  MIN_BOX_SIZE: number
  DEFAULT_BOX_WIDTH: number
  DEFAULT_BOX_HEIGHT: number
  SLIDE_REFERENCE_WIDTH: number
  SLIDE_REFERENCE_HEIGHT: number
  MAX_SELECTIONS: number
}

declare global {
  const C: RuntimeConstants
}

export {}
