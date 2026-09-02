/** Constructors for deck bridge messages, plus parent-side postMessage helpers. */

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
import type {
  DeckBridgeMessageFromRuntime,
  DeckGotoMessage,
  DeckHandshakeMessage,
  DeckMetadata,
  DeckMetadataMessage,
  DeckPatchSlidesMessage,
  DeckPatchSlidesResultMessage,
  DeckReadyMessage,
  DeckRuntimeErrorMessage,
  DeckSlideChangeMessage,
  DeckSlideCountMessage,
  DeckSlidePatchOperation,
} from './types.ts'

export function clampDeckSlideIndex(index: number, slideCount: number) {
  if (!Number.isFinite(index) || slideCount <= 0) {
    return 0
  }

  return Math.max(0, Math.min(slideCount - 1, Math.floor(index)))
}

export function createDeckMetadata(
  input: Partial<DeckMetadata> & Pick<DeckMetadata, 'previewMode'>,
): DeckMetadata {
  return {
    runtime: input.runtime ?? 'unknown',
    title: input.title ?? '',
    previewMode: input.previewMode,
    protocolVersion: DECK_BRIDGE_PROTOCOL_VERSION,
  }
}

export function createDeckGotoMessage(index: number): DeckGotoMessage {
  return { type: DECK_GOTO_MESSAGE_TYPE, index }
}

export function createDeckPatchSlidesMessage(
  patchId: string,
  operations: DeckSlidePatchOperation[],
  index: number,
): DeckPatchSlidesMessage {
  return { type: DECK_PATCH_SLIDES_MESSAGE_TYPE, patchId, operations, index }
}

export function createDeckPatchSlidesResultMessage(
  patchId: string,
  applied: boolean,
  slideCount: number,
): DeckPatchSlidesResultMessage {
  return { type: DECK_PATCH_SLIDES_RESULT_MESSAGE_TYPE, patchId, applied, slideCount }
}

export function createDeckReadyMessage(
  index: number,
  slideCount: number,
  metadata: DeckMetadata,
): DeckReadyMessage {
  return {
    type: DECK_READY_MESSAGE_TYPE,
    index,
    slideCount,
    metadata,
  }
}

export function createDeckSlideCountMessage(slideCount: number): DeckSlideCountMessage {
  return { type: DECK_SLIDE_COUNT_MESSAGE_TYPE, slideCount }
}

export function createDeckSlideChangeMessage(index: number): DeckSlideChangeMessage {
  return { type: DECK_SLIDE_CHANGE_MESSAGE_TYPE, index }
}

export function createDeckMetadataMessage(metadata: DeckMetadata): DeckMetadataMessage {
  return { type: DECK_METADATA_MESSAGE_TYPE, metadata }
}

export function createDeckRuntimeErrorMessage(
  message: string,
  source?: string,
): DeckRuntimeErrorMessage {
  return {
    type: DECK_RUNTIME_ERROR_MESSAGE_TYPE,
    message,
    ...(source ? { source } : {}),
  }
}

export function createDeckHandshakeMessage(handshake: string): DeckHandshakeMessage {
  return {
    type: DECK_HANDSHAKE_MESSAGE_TYPE,
    handshake,
    protocolVersion: DECK_BRIDGE_PROTOCOL_VERSION,
  }
}

export const DECK_BRIDGE_TARGET_ORIGIN = '*' as const

export function getDeckBridgeTargetOrigin(parentOrigin?: string | null) {
  const configured = parentOrigin?.trim()

  if (configured) {
    return configured
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }

  return DECK_BRIDGE_TARGET_ORIGIN
}

export function postDeckGoto(
  target: Window,
  index: number,
  targetOrigin = DECK_BRIDGE_TARGET_ORIGIN,
) {
  target.postMessage(createDeckGotoMessage(index), targetOrigin)
}

export function postDeckBridgeMessage(
  target: Window,
  message: DeckBridgeMessageFromRuntime,
  targetOrigin = DECK_BRIDGE_TARGET_ORIGIN,
) {
  target.postMessage(message, targetOrigin)
}
