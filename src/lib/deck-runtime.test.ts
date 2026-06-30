import { describe, expect, it } from 'vitest'

import fullJsDeck from '@/test/fixtures/full-js-deck.html?raw'
import hostileScriptsDeck from '@/test/fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'
import revealDeck from '@/test/fixtures/reveal-deck.html?raw'

import {
  buildCspMetaTag,
  detectRuntimeMode,
  getBlockedSandboxFeatures,
  getPreviewSandbox,
  getRuntimeCsp,
  getRuntimePolicy,
  getThumbnailSandbox,
  injectRuntimeCsp,
  runtimeModeAllowsDeckScripts,
  runtimeModeToBridgePreviewMode,
  STRICT_DECK_CSP,
} from './deck-runtime'

describe('detectRuntimeMode', () => {
  it('defaults blank and plain CSS decks to static', () => {
    expect(detectRuntimeMode('')).toBe('static')
    expect(detectRuntimeMode(plainCssDeck)).toBe('static')
  })

  it('detects reveal decks from structure or explicit markers', () => {
    expect(detectRuntimeMode(revealDeck)).toBe('reveal')
    expect(detectRuntimeMode('<html data-ark-runtime="reveal"></html>')).toBe('reveal')
    expect(detectRuntimeMode('<html data-ark-deck="reveal"></html>')).toBe('reveal')
  })

  it('enables custom-js only when an explicit Ark marker is present', () => {
    expect(detectRuntimeMode(fullJsDeck)).toBe('custom-js')
    expect(detectRuntimeMode('<html><body data-ark-preview="full-js"></body></html>'))
      .toBe('custom-js')
    expect(detectRuntimeMode('<html><body><script>window.x = 1</script></body></html>'))
      .toBe('static')
    expect(detectRuntimeMode(hostileScriptsDeck)).toBe('static')
  })

  it('prefers custom-js over reveal when both markers are present', () => {
    const html = `<!DOCTYPE html>
<html lang="en" data-ark-deck="nav">
<body>
  <div class="reveal"><div class="slides"><section>One</section></div></div>
</body>
</html>`

    expect(detectRuntimeMode(html)).toBe('custom-js')
  })
})

describe('runtime policies', () => {
  it('uses allow-scripts preview sandbox without same-origin or other risky permissions', () => {
    for (const mode of ['static', 'reveal', 'custom-js'] as const) {
      expect(getPreviewSandbox(mode)).toBe('allow-scripts')
      expect(getPreviewSandbox(mode)).not.toContain('allow-same-origin')
    }
  })

  it('keeps thumbnails fully locked down', () => {
    expect(getThumbnailSandbox()).toBe('')
  })

  it('blocks risky sandbox features by default', () => {
    const blocked = getBlockedSandboxFeatures()

    expect(blocked).toContain('allow-same-origin')
    expect(blocked).toContain('allow-forms')
    expect(blocked).toContain('allow-popups')
    expect(blocked).toContain('allow-top-navigation')
  })

  it('applies strict CSP with connect-src none across runtime modes', () => {
    for (const mode of ['static', 'reveal', 'custom-js'] as const) {
      const csp = getRuntimeCsp(mode)

      expect(csp).toContain("connect-src 'none'")
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("worker-src 'none'")
      expect(csp).toContain("frame-src 'none'")
      expect(csp).toContain("form-action 'none'")
    }
  })

  it('only allows deck scripts in custom-js mode', () => {
    expect(runtimeModeAllowsDeckScripts('static')).toBe(false)
    expect(runtimeModeAllowsDeckScripts('reveal')).toBe(false)
    expect(runtimeModeAllowsDeckScripts('custom-js')).toBe(true)
    expect(getRuntimePolicy('custom-js').allowsDeckScripts).toBe(true)
  })
})

describe('injectRuntimeCsp', () => {
  it('injects a CSP meta tag into the document head', () => {
    const html = injectRuntimeCsp(plainCssDeck, 'static')

    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toContain(STRICT_DECK_CSP)
    expect(buildCspMetaTag(STRICT_DECK_CSP)).toContain("connect-src 'none'")
  })
})

describe('runtimeModeToBridgePreviewMode', () => {
  it('maps runtime modes to bridge preview modes', () => {
    expect(runtimeModeToBridgePreviewMode('static')).toBe('css-only')
    expect(runtimeModeToBridgePreviewMode('reveal')).toBe('css-only')
    expect(runtimeModeToBridgePreviewMode('custom-js')).toBe('full-js')
  })
})
