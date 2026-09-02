import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  buildDeckBridgeRuntimeScript,
  buildDeckCssNavRuntimeScript,
  buildDeckHandshakeSentinelScript,
  buildRevealNavRuntimeScript,
} from '../index.ts'

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

describe('deck handshake sentinel', () => {
  it('injects a retrying head handshake sentinel', () => {
    expect(buildDeckHandshakeSentinelScript('hs-abc', 'http://localhost:5173')).toContain(
      'ark:deck-handshake',
    )
    expect(buildDeckHandshakeSentinelScript('hs-abc')).toContain('hs-abc')
    // Retries cover parents that attach the handshake listener after first paint.
    expect(buildDeckHandshakeSentinelScript('hs-abc')).toContain('safeSetTimeout(postHandshake')
  })
})

describe('CSS-only nav shim', () => {
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

describe('injected runtime string identity', () => {
  const cssOpts = { slideSelectors: ['section.slide'] as const, previewMode: 'css-only' as const }
  const fullOpts = {
    slideSelectors: ['section.slide', '.reveal .slides > section'] as const,
    previewMode: 'full-js' as const,
    parentOrigin: 'http://localhost:5173',
  }
  const revealOpts = {
    slideSelectors: ['.reveal .slides > section'] as const,
    previewMode: 'full-js' as const,
  }

  it('keeps assembled handshake and runtime scripts byte-identical to the pre-split builders', () => {
    expect(sha256(buildDeckHandshakeSentinelScript('hs-abc', 'http://localhost:5173'))).toBe(
      '6b1c36caf9fbca6fabdab26bb15f70d10ccea88b6a5c085d36b1b60ee85f8cc0',
    )
    expect(sha256(buildDeckHandshakeSentinelScript('hs-abc'))).toBe(
      '80724724ad6885a85152c9bad753a1deadf04e1dad4cec552be3edd1cab899ba',
    )
    expect(
      sha256(
        buildDeckHandshakeSentinelScript('hs-abc', 'http://localhost:5173', '__arkEditorSessionV1'),
      ),
    ).toBe('7c4fb64fa1bef9ef6ca7bb0829ccbc7564c74de409e5f7ebf029c1e96ee52acb')
    expect(sha256(buildDeckHandshakeSentinelScript('hs-abc', null, '  '))).toBe(
      '80724724ad6885a85152c9bad753a1deadf04e1dad4cec552be3edd1cab899ba',
    )

    expect(sha256(buildDeckBridgeRuntimeScript(cssOpts))).toBe(
      'a079a591500bbad600d0988abc6ae24858a8d9983022e5b840437df47d8340d5',
    )
    expect(sha256(buildDeckBridgeRuntimeScript(fullOpts))).toBe(
      '51a7fa98c74e79911d66fbff9cc2a1bc294b33c04112e27d9461ca4b902b37a3',
    )
    expect(sha256(buildDeckCssNavRuntimeScript(cssOpts))).toBe(
      '109dd8058cee5c7530af6ee1f8ccf094eba7b31a30e2bbbd34c877df89777afb',
    )
    expect(sha256(buildDeckCssNavRuntimeScript(fullOpts))).toBe(
      '633879c834905c84c9d483dc1af910966efeaf97f123b40395ffeab62a3ae998',
    )
    expect(sha256(buildRevealNavRuntimeScript(revealOpts))).toBe(
      '5c864b266c4ea9fb653739206352d7f22c2823bb6762e32e1269d9aceaeaad76',
    )
    expect(
      sha256(buildRevealNavRuntimeScript({ slideSelectors: [], previewMode: 'css-only' })),
    ).toBe('331936a66f0899bcb39d0a3ebe4b7b0ae2b4448ea34d5d82e154760c8dc9c1dd')
    expect(sha256(buildRevealNavRuntimeScript(fullOpts))).toBe(
      'f20827195a54fcde93ecc63662782796209f2aad4eafbd164b4ea731658d0923',
    )
  })
})
