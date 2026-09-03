/**
 * The shape of every deck bridge message, plus the metadata payloads they carry.
 */

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
} from './message-types.ts'

export type DeckRuntimeKind = 'plain' | 'reveal' | 'unknown'

export type DeckPreviewMode = 'css-only' | 'full-js'

export type PreviewMode = DeckPreviewMode

export type DeckMetadata = {
  runtime: DeckRuntimeKind
  title: string
  previewMode: DeckPreviewMode
  protocolVersion: typeof DECK_BRIDGE_PROTOCOL_VERSION
}

export type DeckGotoMessage = {
  type: typeof DECK_GOTO_MESSAGE_TYPE
  index: number
}

/**
 * Slide-list edit script applied against the live preview DOM.
 *
 * Operations are positional and applied in order against the evolving slide
 * list, so `remove` + `insert` at the same index is an in-place swap.
 */
export type DeckSlidePatchOperation =
  { op: 'remove'; index: number } | { op: 'insert'; index: number; html: string }

export type DeckPatchSlidesMessage = {
  type: typeof DECK_PATCH_SLIDES_MESSAGE_TYPE
  /** Correlates the runtime's result so a stale reply cannot force a reload. */
  patchId: string
  operations: DeckSlidePatchOperation[]
  /** Slide to show once the patch lands (the shell's preserved active slide). */
  index: number
}

export type DeckPatchSlidesResultMessage = {
  type: typeof DECK_PATCH_SLIDES_RESULT_MESSAGE_TYPE
  patchId: string
  applied: boolean
  /** Slide count after the patch; the shell reloads when it disagrees. */
  slideCount: number
}

export type DeckReadyMessage = {
  type: typeof DECK_READY_MESSAGE_TYPE
  index: number
  slideCount: number
  metadata: DeckMetadata
}

export type DeckSlideCountMessage = {
  type: typeof DECK_SLIDE_COUNT_MESSAGE_TYPE
  slideCount: number
}

export type DeckSlideChangeMessage = {
  type: typeof DECK_SLIDE_CHANGE_MESSAGE_TYPE
  index: number
}

export type DeckMetadataMessage = {
  type: typeof DECK_METADATA_MESSAGE_TYPE
  metadata: DeckMetadata
}

export type DeckRuntimeErrorMessage = {
  type: typeof DECK_RUNTIME_ERROR_MESSAGE_TYPE
  message: string
  source?: string
}

/**
 * Generation-correlation handshake posted by the Ark-injected head sentinel.
 * The sentinel removes its script node before deck code runs so the value can
 * also authenticate the editor's private MessagePort bootstrap.
 */
export type DeckHandshakeMessage = {
  type: typeof DECK_HANDSHAKE_MESSAGE_TYPE
  handshake: string
  protocolVersion: typeof DECK_BRIDGE_PROTOCOL_VERSION
}

export type DeckBridgeMessage =
  | DeckGotoMessage
  | DeckPatchSlidesMessage
  | DeckPatchSlidesResultMessage
  | DeckReadyMessage
  | DeckSlideCountMessage
  | DeckSlideChangeMessage
  | DeckMetadataMessage
  | DeckRuntimeErrorMessage

export type DeckBridgeMessageFromRuntime = Exclude<
  DeckBridgeMessage,
  DeckGotoMessage | DeckPatchSlidesMessage
>
