import { describe, expect, it } from 'vitest'

import {
  DECK_BRIDGE_PROTOCOL_VERSION,
  DECK_GOTO_MESSAGE_TYPE,
  DECK_HANDSHAKE_MESSAGE_TYPE,
  DECK_METADATA_MESSAGE_TYPE,
  DECK_READY_MESSAGE_TYPE,
  DECK_RUNTIME_ERROR_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
  DECK_SLIDE_COUNT_MESSAGE_TYPE,
  buildDeckCssNavRuntimeScript,
  buildDeckHandshakeSentinelScript,
  buildRevealNavRuntimeScript,
  clampDeckSlideIndex,
  createDeckGotoMessage,
  createDeckHandshakeMessage,
  createDeckMetadata,
  createDeckMetadataMessage,
  createDeckReadyMessage,
  createDeckRuntimeErrorMessage,
  createDeckSlideChangeMessage,
  createDeckSlideCountMessage,
  isDeckBridgeMessage,
  isDeckBridgeMessageFromRuntime,
  isDeckGotoMessage,
  isDeckHandshakeMessage,
  isDeckMetadata,
  isDeckMetadataMessage,
  isDeckReadyMessage,
  isDeckRuntimeErrorMessage,
  isDeckSlideChangeMessage,
  isDeckSlideCountMessage,
  parseDeckBridgeMessage,
} from './deck-bridge'
describe('deck bridge protocol', () => {
  const metadata = createDeckMetadata({
    runtime: 'plain',
    title: 'Demo',
    previewMode: 'css-only',
  })

  it('creates canonical parent goto messages', () => {
    expect(createDeckGotoMessage(2)).toEqual({
      type: DECK_GOTO_MESSAGE_TYPE,
      index: 2,
    })
  })

  it('creates runtime lifecycle messages', () => {
    expect(createDeckReadyMessage(1, 4, metadata)).toEqual({
      type: DECK_READY_MESSAGE_TYPE,
      index: 1,
      slideCount: 4,
      metadata,
    })
    expect(createDeckSlideCountMessage(4)).toEqual({
      type: DECK_SLIDE_COUNT_MESSAGE_TYPE,
      slideCount: 4,
    })
    expect(createDeckSlideChangeMessage(2)).toEqual({
      type: DECK_SLIDE_CHANGE_MESSAGE_TYPE,
      index: 2,
    })
    expect(createDeckMetadataMessage(metadata)).toEqual({
      type: DECK_METADATA_MESSAGE_TYPE,
      metadata,
    })
    expect(createDeckRuntimeErrorMessage('boom', 'deck.js')).toEqual({
      type: DECK_RUNTIME_ERROR_MESSAGE_TYPE,
      message: 'boom',
      source: 'deck.js',
    })
  })

  it('creates and validates additive handshake messages', () => {
    expect(createDeckHandshakeMessage('hs-abc')).toEqual({
      type: DECK_HANDSHAKE_MESSAGE_TYPE,
      handshake: 'hs-abc',
      protocolVersion: DECK_BRIDGE_PROTOCOL_VERSION,
    })
    expect(isDeckHandshakeMessage(createDeckHandshakeMessage('hs-abc'))).toBe(true)
    expect(isDeckHandshakeMessage({ type: DECK_HANDSHAKE_MESSAGE_TYPE, handshake: '' })).toBe(false)
    expect(buildDeckHandshakeSentinelScript('hs-abc', 'http://localhost:5173')).toContain(
      'ark:deck-handshake',
    )
    expect(buildDeckHandshakeSentinelScript('hs-abc')).toContain('hs-abc')
    // Retries cover parents that attach the handshake listener after first paint.
    expect(buildDeckHandshakeSentinelScript('hs-abc')).toContain('safeSetTimeout(postHandshake')
  })

  it('validates known bridge messages and rejects malformed payloads', () => {
    expect(isDeckGotoMessage(createDeckGotoMessage(0))).toBe(true)
    expect(isDeckReadyMessage(createDeckReadyMessage(0, 3, metadata))).toBe(true)
    expect(isDeckSlideCountMessage(createDeckSlideCountMessage(3))).toBe(true)
    expect(isDeckSlideChangeMessage(createDeckSlideChangeMessage(1))).toBe(true)
    expect(isDeckMetadataMessage(createDeckMetadataMessage(metadata))).toBe(true)
    expect(isDeckRuntimeErrorMessage(createDeckRuntimeErrorMessage('x'))).toBe(true)

    expect(isDeckBridgeMessage({ type: DECK_GOTO_MESSAGE_TYPE, index: 'bad' })).toBe(false)
    expect(isDeckBridgeMessage({ type: 'ark:unknown', index: 0 })).toBe(false)
    expect(parseDeckBridgeMessage(null)).toBeNull()
    expect(parseDeckBridgeMessage(createDeckSlideChangeMessage(0))).toEqual({
      type: DECK_SLIDE_CHANGE_MESSAGE_TYPE,
      index: 0,
    })
  })

  it('distinguishes parent commands from runtime messages', () => {
    expect(isDeckBridgeMessageFromRuntime(createDeckGotoMessage(0))).toBe(false)
    expect(isDeckBridgeMessageFromRuntime(createDeckReadyMessage(0, 1, metadata))).toBe(true)
  })

  it('clamps slide indexes to available slides', () => {
    expect(clampDeckSlideIndex(-2, 5)).toBe(0)
    expect(clampDeckSlideIndex(2.9, 5)).toBe(2)
    expect(clampDeckSlideIndex(99, 5)).toBe(4)
    expect(clampDeckSlideIndex(1, 0)).toBe(0)
  })

  it('requires protocol version on metadata', () => {
    expect(isDeckMetadata(metadata)).toBe(true)
    expect(isDeckMetadata({ ...metadata, protocolVersion: 99 })).toBe(false)
    expect(createDeckMetadata({ previewMode: 'full-js' }).protocolVersion).toBe(
      DECK_BRIDGE_PROTOCOL_VERSION,
    )
  })

  it('skips arrow-key navigation while inline text editing', () => {
    const script = buildDeckCssNavRuntimeScript({
      slideSelectors: ['section.slide'],
      previewMode: 'css-only',
    })

    expect(script).toContain('isTypingTarget')
    expect(script).toContain('data-ark-editor-text-edit')
    expect(script).toContain('data-ark-editor-selected')
  })
})

describe('Reveal adapter', () => {
  it('preserves Reveal deck dimensions', () => {
    const script = buildRevealNavRuntimeScript({
      slideSelectors: ['.reveal .slides > section'],
      previewMode: 'full-js',
    })

    expect(script).not.toContain('width: C.SLIDE_WIDTH')
    expect(script).not.toContain('height: C.SLIDE_HEIGHT')
  })

  it('dispatches ark:deck-slide-change DOM events from the reveal adapter', () => {
    const script = buildRevealNavRuntimeScript({
      slideSelectors: ['.reveal .slides > section'],
      previewMode: 'full-js',
    })

    expect(script).toContain('document.dispatchEvent(new CustomEvent(C.CHANGE')
    expect(script).toContain('detail: { index: clamped }')
  })
})
