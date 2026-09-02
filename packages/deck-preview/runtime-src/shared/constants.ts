export type DeckPreviewMode = 'css-only' | 'full-js'

export type RuntimeConstants = {
  PROTOCOL_VERSION: number
  HANDSHAKE_TYPE: string
  HANDSHAKE: string
  EDITOR_SESSION_HANDOFF_KEY: string
  GOTO: string
  PATCH: string
  PATCH_RESULT: string
  READY: string
  SLIDE_COUNT: string
  CHANGE: string
  METADATA: string
  ERROR: string
  SELECTORS: string[]
  PREVIEW_MODE: DeckPreviewMode
  NAV_KEYS: { [key: string]: number }
  PARENT_ORIGIN: string
}

declare global {
  const C: RuntimeConstants
}

export {}
