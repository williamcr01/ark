import type { DeckPreviewMode } from '../protocol/types.ts'
import {
  DECK_BRIDGE_PROTOCOL_VERSION,
  DECK_GOTO_MESSAGE_TYPE,
  DECK_HANDSHAKE_MESSAGE_TYPE,
  DECK_METADATA_MESSAGE_TYPE,
  DECK_PATCH_SLIDES_MESSAGE_TYPE,
  DECK_PATCH_SLIDES_RESULT_MESSAGE_TYPE,
  DECK_READY_MESSAGE_TYPE,
  DECK_RUNTIME_ERROR_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
  DECK_SLIDE_COUNT_MESSAGE_TYPE,
} from '../protocol/message-types.ts'

export type DeckBridgeRuntimeScriptOptions = {
  slideSelectors: readonly string[]
  previewMode: DeckPreviewMode
  parentOrigin?: string
}

export type DeckPreviewRuntimeConstants = {
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

const DEFAULT_NAV_KEYS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }

export function createDeckPreviewRuntimeConstants(
  options: Partial<DeckPreviewRuntimeConstants> &
    Pick<DeckPreviewRuntimeConstants, 'PREVIEW_MODE' | 'SELECTORS' | 'PARENT_ORIGIN'>,
): DeckPreviewRuntimeConstants {
  return {
    PROTOCOL_VERSION: DECK_BRIDGE_PROTOCOL_VERSION,
    HANDSHAKE_TYPE: DECK_HANDSHAKE_MESSAGE_TYPE,
    HANDSHAKE: '',
    EDITOR_SESSION_HANDOFF_KEY: '',
    GOTO: DECK_GOTO_MESSAGE_TYPE,
    PATCH: DECK_PATCH_SLIDES_MESSAGE_TYPE,
    PATCH_RESULT: DECK_PATCH_SLIDES_RESULT_MESSAGE_TYPE,
    READY: DECK_READY_MESSAGE_TYPE,
    SLIDE_COUNT: DECK_SLIDE_COUNT_MESSAGE_TYPE,
    CHANGE: DECK_SLIDE_CHANGE_MESSAGE_TYPE,
    METADATA: DECK_METADATA_MESSAGE_TYPE,
    ERROR: DECK_RUNTIME_ERROR_MESSAGE_TYPE,
    NAV_KEYS: DEFAULT_NAV_KEYS,
    ...options,
  }
}

export function assembleDeckPreviewRuntimeScript(
  constants: DeckPreviewRuntimeConstants,
  source: string,
) {
  return `var C = ${JSON.stringify(constants)};\n${source}`
}

export function navRuntimeConstantsFromOptions(options: DeckBridgeRuntimeScriptOptions) {
  return createDeckPreviewRuntimeConstants({
    SELECTORS: [...(options.slideSelectors ?? [])],
    PREVIEW_MODE: options.previewMode,
    PARENT_ORIGIN: options.parentOrigin?.trim() || '',
  })
}
