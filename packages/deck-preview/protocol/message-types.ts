/**
 * Wire identifiers for the deck bridge protocol: every `ark:deck-*` message
 * type the shell and the injected iframe runtimes exchange.
 *
 * @see docs/deck-bridge.md
 */

export const DECK_BRIDGE_PROTOCOL_VERSION = 1 as const

export const DECK_GOTO_MESSAGE_TYPE = 'ark:deck-goto' as const
/** Parent → frame: swap individual slides in place instead of reloading the deck. */
export const DECK_PATCH_SLIDES_MESSAGE_TYPE = 'ark:deck-patch-slides' as const
/** Frame → parent: whether the slide patch applied, so the shell can fall back to a reload. */
export const DECK_PATCH_SLIDES_RESULT_MESSAGE_TYPE = 'ark:deck-patch-slides-result' as const
export const DECK_READY_MESSAGE_TYPE = 'ark:deck-ready' as const
export const DECK_SLIDE_COUNT_MESSAGE_TYPE = 'ark:deck-slide-count' as const
export const DECK_SLIDE_CHANGE_MESSAGE_TYPE = 'ark:deck-slide-change' as const
export const DECK_METADATA_MESSAGE_TYPE = 'ark:deck-metadata' as const
export const DECK_RUNTIME_ERROR_MESSAGE_TYPE = 'ark:deck-runtime-error' as const
/** Additive handshake from the Ark head sentinel before deck-authored scripts. */
export const DECK_HANDSHAKE_MESSAGE_TYPE = 'ark:deck-handshake' as const

export const DECK_GOTO_EVENT = DECK_GOTO_MESSAGE_TYPE
export const DECK_SLIDE_CHANGE_EVENT = DECK_SLIDE_CHANGE_MESSAGE_TYPE
export const DECK_METADATA_EVENT = DECK_METADATA_MESSAGE_TYPE

export const DECK_BRIDGE_MESSAGE_TYPES = [
  DECK_GOTO_MESSAGE_TYPE,
  DECK_PATCH_SLIDES_MESSAGE_TYPE,
  DECK_PATCH_SLIDES_RESULT_MESSAGE_TYPE,
  DECK_READY_MESSAGE_TYPE,
  DECK_SLIDE_COUNT_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
  DECK_METADATA_MESSAGE_TYPE,
  DECK_RUNTIME_ERROR_MESSAGE_TYPE,
] as const

export type DeckBridgeMessageType = (typeof DECK_BRIDGE_MESSAGE_TYPES)[number]
