import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import fullJsDeck from '../test/fixtures/full-js-deck.html?raw'
import hostileScriptsDeck from '../test/fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '../test/fixtures/plain-css-deck.html?raw'
import revealDeck from '../test/fixtures/reveal-deck.html?raw'

import { validateDeckHtml } from '../shared/deck-validate.ts'

describe('validateDeckHtml with JSDOM', () => {
  it('detects runtime modes on the server path without browser DOMParser', () => {
    const parseDocument = (source: string) => new JSDOM(source).window.document

    expect(validateDeckHtml(plainCssDeck, parseDocument).runtimeMarkers.runtimeMode).toBe('static')
    expect(validateDeckHtml(revealDeck, parseDocument).runtimeMarkers.runtimeMode).toBe('reveal')
    expect(validateDeckHtml(fullJsDeck, parseDocument).runtimeMarkers.runtimeMode).toBe('custom-js')
    expect(validateDeckHtml(hostileScriptsDeck, parseDocument).runtimeMarkers.runtimeMode).toBe(
      'static',
    )
  })
})
