import { describe, expect, it } from 'vitest'

import fullJsDeck from '@/test/fixtures/full-js-deck.html?raw'
import hostileScriptsDeck from '@/test/fixtures/hostile-scripts-deck.html?raw'
import malformedDeck from '@/test/fixtures/malformed-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'
import revealDeck from '@/test/fixtures/reveal-deck.html?raw'
import {
  detectRuntimeMode,
  getPreviewSandbox,
  getRuntimeCsp,
  getThumbnailSandbox,
  injectRuntimeCsp,
} from '@/lib/deck-runtime'
import { getPreviewHtml } from '@/lib/deck-preview'
import { stripDeckScriptsForPreview } from '@/lib/deck-slides'
import { validateDeckHtmlInBrowser } from '@/lib/deck-validate'

const fixtures = [
  { name: 'plain-css', html: plainCssDeck, runtimeMode: 'static' as const },
  { name: 'reveal', html: revealDeck, runtimeMode: 'reveal' as const },
  { name: 'full-js', html: fullJsDeck, runtimeMode: 'custom-js' as const },
  { name: 'hostile-scripts', html: hostileScriptsDeck, runtimeMode: 'static' as const },
  { name: 'malformed', html: malformedDeck, runtimeMode: 'static' as const },
]

describe('sandbox security fixtures', () => {
  it.each(fixtures)('detects expected runtime mode for $name fixture', ({ html, runtimeMode }) => {
    expect(detectRuntimeMode(html)).toBe(runtimeMode)
  })

  it('strips hostile scripts and inline handlers from preview HTML', () => {
    const stripped = stripDeckScriptsForPreview(hostileScriptsDeck)
    const previewHtml = getPreviewHtml(hostileScriptsDeck)

    expect(stripped).not.toContain('<script')
    expect(stripped).not.toContain('window.evilHead')
    expect(stripped).not.toContain('window.evilModule')
    expect(previewHtml).toContain('data-ark-preview-nav')
    expect(previewHtml).not.toContain('data-ark-preview-bridge')
    expect(previewHtml).not.toContain('window.evilHead')
    expect(previewHtml).not.toContain('window.evilModule')
    expect(previewHtml).not.toContain('onload=')
    expect(previewHtml).not.toContain('onclick=')
    expect(previewHtml).not.toContain('onerror=')
  })

  it('uses locked-down thumbnail sandbox and allow-scripts preview sandbox', () => {
    expect(getThumbnailSandbox()).toBe('')

    for (const fixture of fixtures) {
      expect(getPreviewSandbox(fixture.runtimeMode)).toBe('allow-scripts')
      expect(getPreviewSandbox(fixture.runtimeMode)).not.toContain('allow-same-origin')
    }
  })

  it('applies strict CSP with connect-src none across fixtures', () => {
    for (const fixture of fixtures) {
      const csp = getRuntimeCsp(fixture.runtimeMode)
      const injected = injectRuntimeCsp(fixture.html, fixture.runtimeMode)

      expect(csp).toContain("connect-src 'none'")
      expect(injected).toContain('Content-Security-Policy')
      expect(injected).toContain("connect-src 'none'")
    }
  })

  it('flags hostile scripts without an Ark runtime marker', () => {
    const report = validateDeckHtmlInBrowser(hostileScriptsDeck)

    expect(report.valid).toBe(true)
    expect(report.runtimeMarkers.runtimeMode).toBe('static')
    expect(report.issues.some((issue) => issue.code === 'script_without_marker')).toBe(true)
  })

  it('rejects malformed nested-slide fixtures', () => {
    const report = validateDeckHtmlInBrowser(malformedDeck)

    expect(report.valid).toBe(false)
    expect(report.issues.some((issue) => issue.code === 'nested_slides')).toBe(true)
  })
})
