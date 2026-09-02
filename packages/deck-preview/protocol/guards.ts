/** Runtime validation for deck bridge messages arriving over `postMessage`. */

import {
  DECK_BRIDGE_MESSAGE_TYPES,
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
import type { DeckBridgeMessageType } from './message-types.ts'
import type {
  DeckBridgeMessage,
  DeckBridgeMessageFromRuntime,
  DeckGotoMessage,
  DeckHandshakeMessage,
  DeckMetadata,
  DeckMetadataMessage,
  DeckPatchSlidesMessage,
  DeckPatchSlidesResultMessage,
  DeckPreviewMode,
  DeckReadyMessage,
  DeckRuntimeErrorMessage,
  DeckRuntimeKind,
  DeckSlideChangeMessage,
  DeckSlideCountMessage,
  DeckSlidePatchOperation,
} from './types.ts'

const DECK_BRIDGE_MESSAGE_TYPE_SET = new Set<string>(DECK_BRIDGE_MESSAGE_TYPES)

export function isDeckBridgeMessageType(value: unknown): value is DeckBridgeMessageType {
  return typeof value === 'string' && DECK_BRIDGE_MESSAGE_TYPE_SET.has(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isDeckRuntimeKind(value: unknown): value is DeckRuntimeKind {
  return value === 'plain' || value === 'reveal' || value === 'unknown'
}

function isDeckPreviewMode(value: unknown): value is DeckPreviewMode {
  return value === 'css-only' || value === 'full-js'
}

export function isDeckMetadata(value: unknown): value is DeckMetadata {
  if (!isRecord(value)) {
    return false
  }

  return (
    isDeckRuntimeKind(value.runtime) &&
    typeof value.title === 'string' &&
    isDeckPreviewMode(value.previewMode) &&
    value.protocolVersion === DECK_BRIDGE_PROTOCOL_VERSION
  )
}

export function isDeckGotoMessage(value: unknown): value is DeckGotoMessage {
  return isRecord(value) && value.type === DECK_GOTO_MESSAGE_TYPE && isFiniteNumber(value.index)
}

function isDeckSlidePatchOperation(value: unknown): value is DeckSlidePatchOperation {
  if (!isRecord(value) || !isFiniteNumber(value.index) || value.index < 0) {
    return false
  }

  if (value.op === 'remove') {
    return true
  }

  return value.op === 'insert' && typeof value.html === 'string'
}

export function isDeckPatchSlidesMessage(value: unknown): value is DeckPatchSlidesMessage {
  return (
    isRecord(value) &&
    value.type === DECK_PATCH_SLIDES_MESSAGE_TYPE &&
    typeof value.patchId === 'string' &&
    isFiniteNumber(value.index) &&
    Array.isArray(value.operations) &&
    value.operations.every(isDeckSlidePatchOperation)
  )
}

export function isDeckPatchSlidesResultMessage(
  value: unknown,
): value is DeckPatchSlidesResultMessage {
  return (
    isRecord(value) &&
    value.type === DECK_PATCH_SLIDES_RESULT_MESSAGE_TYPE &&
    typeof value.patchId === 'string' &&
    typeof value.applied === 'boolean' &&
    isFiniteNumber(value.slideCount)
  )
}

export function isDeckReadyMessage(value: unknown): value is DeckReadyMessage {
  return (
    isRecord(value) &&
    value.type === DECK_READY_MESSAGE_TYPE &&
    isFiniteNumber(value.index) &&
    isFiniteNumber(value.slideCount) &&
    isDeckMetadata(value.metadata)
  )
}

export function isDeckSlideCountMessage(value: unknown): value is DeckSlideCountMessage {
  return (
    isRecord(value) &&
    value.type === DECK_SLIDE_COUNT_MESSAGE_TYPE &&
    isFiniteNumber(value.slideCount)
  )
}

export function isDeckSlideChangeMessage(value: unknown): value is DeckSlideChangeMessage {
  return (
    isRecord(value) && value.type === DECK_SLIDE_CHANGE_MESSAGE_TYPE && isFiniteNumber(value.index)
  )
}

export function isDeckMetadataMessage(value: unknown): value is DeckMetadataMessage {
  return (
    isRecord(value) && value.type === DECK_METADATA_MESSAGE_TYPE && isDeckMetadata(value.metadata)
  )
}

export function isDeckRuntimeErrorMessage(value: unknown): value is DeckRuntimeErrorMessage {
  return (
    isRecord(value) &&
    value.type === DECK_RUNTIME_ERROR_MESSAGE_TYPE &&
    typeof value.message === 'string' &&
    (value.source === undefined || typeof value.source === 'string')
  )
}

export function isDeckHandshakeMessage(value: unknown): value is DeckHandshakeMessage {
  return (
    isRecord(value) &&
    value.type === DECK_HANDSHAKE_MESSAGE_TYPE &&
    typeof value.handshake === 'string' &&
    value.handshake.length > 0 &&
    value.protocolVersion === DECK_BRIDGE_PROTOCOL_VERSION
  )
}

export function isDeckBridgeMessage(value: unknown): value is DeckBridgeMessage {
  return (
    isDeckGotoMessage(value) ||
    isDeckPatchSlidesMessage(value) ||
    isDeckPatchSlidesResultMessage(value) ||
    isDeckReadyMessage(value) ||
    isDeckSlideCountMessage(value) ||
    isDeckSlideChangeMessage(value) ||
    isDeckMetadataMessage(value) ||
    isDeckRuntimeErrorMessage(value)
  )
}

export function isDeckBridgeMessageFromRuntime(
  value: unknown,
): value is DeckBridgeMessageFromRuntime {
  return (
    isDeckBridgeMessage(value) &&
    value.type !== DECK_GOTO_MESSAGE_TYPE &&
    value.type !== DECK_PATCH_SLIDES_MESSAGE_TYPE
  )
}

export function parseDeckBridgeMessage(value: unknown): DeckBridgeMessage | null {
  return isDeckBridgeMessage(value) ? value : null
}
