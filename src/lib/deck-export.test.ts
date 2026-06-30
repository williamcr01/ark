import { describe, expect, it } from 'vitest'

import fullJsDeck from '@/test/fixtures/full-js-deck.html?raw'
import hostileScriptsDeck from '@/test/fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'

import {
  buildSanitizedDeckHtml,
  deckHasExecutableContent,
  previewStripsDeckScripts,
  resolveDownloadHtml,
} from './deck-export'

describe('deck-export', () => {
  it('detects executable content in hostile scripted decks', () => {
    expect(deckHasExecutableContent(hostileScriptsDeck)).toBe(true)
    expect(previewStripsDeckScripts(hostileScriptsDeck)).toBe(true)
  })

  it('does not treat plain CSS decks as executable', () => {
    expect(deckHasExecutableContent(plainCssDeck)).toBe(false)
    expect(previewStripsDeckScripts(plainCssDeck)).toBe(false)
  })

  it('keeps full-js decks executable in preview', () => {
    expect(deckHasExecutableContent(fullJsDeck)).toBe(true)
    expect(previewStripsDeckScripts(fullJsDeck)).toBe(false)
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
