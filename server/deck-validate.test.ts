import { describe, expect, it } from 'vitest'

import fullJsDeck from '../test/fixtures/full-js-deck.html?raw'
import plainCssDeck from '../test/fixtures/plain-css-deck.html?raw'
import revealDeck from '../test/fixtures/reveal-deck.html?raw'

import { validateDeckHtmlOnServer } from './deck-validate.ts'

describe('validateDeckHtmlOnServer', () => {
  it('accepts a plain CSS deck and reports slide metadata', () => {
    const report = validateDeckHtmlOnServer(plainCssDeck)

    expect(report.valid).toBe(true)
    expect(report.slideCount).toBe(3)
    expect(report.runtimeMarkers.runtimeMode).toBe('static')
    expect(report.issues).toEqual([])
  })

  it('detects reveal and custom-js runtime modes', () => {
    expect(validateDeckHtmlOnServer(revealDeck).runtimeMarkers.runtimeMode).toBe('reveal')
    expect(validateDeckHtmlOnServer(fullJsDeck).runtimeMarkers.runtimeMode).toBe('custom-js')
  })

  it('rejects empty HTML', () => {
    const report = validateDeckHtmlOnServer('')

    expect(report.valid).toBe(false)
    expect(report.slideCount).toBe(0)
    expect(report.issues[0]?.code).toBe('missing_html')
  })
})
