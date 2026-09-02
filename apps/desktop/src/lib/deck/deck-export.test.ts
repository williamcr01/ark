import { describe, expect, it } from 'vitest'

import chartRegistryDeck from '@fixtures/chart-registry-deck.html?raw'
import fullJsDeck from '@fixtures/full-js-deck.html?raw'
import hostileScriptsDeck from '@fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'

import { exampleDeckThemes, serializeDeckThemeSpec } from '@ark/deck/document/theme.ts'

import {
  buildSanitizedDeckHtml,
  deckHasExecutableContent,
  previewStripsDeckScripts,
  resolveDownloadHtml,
} from './deck-export'
import { buildDeckRuntimeManifestInBrowser } from './deck-runtime-manifest'

const inlineHandlerDeck = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Inline Handler Deck</title>
</head>
<body>
  <section class="slide" onclick="window.clicked = true">
    <h1>Hello</h1>
  </section>
</body>
</html>`

describe('deck-export', () => {
  it('detects executable content in hostile scripted decks', () => {
    expect(deckHasExecutableContent(hostileScriptsDeck)).toBe(true)
    expect(previewStripsDeckScripts(hostileScriptsDeck)).toBe(true)
  })

  it('does not treat plain CSS decks as executable', () => {
    expect(deckHasExecutableContent(plainCssDeck)).toBe(false)
    expect(previewStripsDeckScripts(plainCssDeck)).toBe(false)
  })

  it('does not treat inert theme metadata as executable content', () => {
    const theme = exampleDeckThemes().midnight
    const html = `<!DOCTYPE html><html><head>
<script type="application/json" data-ark-theme>${serializeDeckThemeSpec(theme)}</script>
</head><body><section class="slide"><h1>Cover</h1></section></body></html>`

    expect(deckHasExecutableContent(html)).toBe(false)
    expect(previewStripsDeckScripts(html)).toBe(false)
  })

  it('keeps inline handler stripping visible when a manifest is provided', () => {
    const manifest = buildDeckRuntimeManifestInBrowser(inlineHandlerDeck)

    expect(manifest.scripts.inline + manifest.scripts.external).toBe(0)
    expect(deckHasExecutableContent(inlineHandlerDeck)).toBe(true)
    expect(previewStripsDeckScripts(inlineHandlerDeck, manifest)).toBe(true)
  })

  it('keeps full-js decks executable in preview', () => {
    expect(deckHasExecutableContent(fullJsDeck)).toBe(true)
    expect(previewStripsDeckScripts(fullJsDeck)).toBe(false)
  })

  it('keeps chart.js decks executable in original download and strips them when sanitized', () => {
    expect(deckHasExecutableContent(chartRegistryDeck)).toBe(true)
    expect(previewStripsDeckScripts(chartRegistryDeck)).toBe(false)
    expect(resolveDownloadHtml(chartRegistryDeck, 'original')).toContain(
      '/api/runtimes/chart.js/4.5.1/chart.umd.min.js',
    )
    const sanitized = resolveDownloadHtml(chartRegistryDeck, 'sanitized')
    expect(sanitized).not.toContain('<script')
    expect(sanitized).toContain('Quarterly revenue')
  })

  it('builds sanitized HTML without scripts or inline handlers', () => {
    const sanitized = buildSanitizedDeckHtml(hostileScriptsDeck)

    expect(sanitized).not.toContain('<script')
    expect(sanitized).not.toContain('onclick=')
    expect(sanitized).not.toContain('onload=')
    expect(sanitized).toContain('Hostile opening')
  })

  it('resolves original and sanitized download variants', () => {
    expect(resolveDownloadHtml(plainCssDeck, 'original')).toBe(plainCssDeck)
    expect(resolveDownloadHtml(hostileScriptsDeck, 'sanitized')).toBe(
      buildSanitizedDeckHtml(hostileScriptsDeck),
    )
  })
})
