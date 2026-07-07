import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { validateDeckHtmlOnServer } from './deck-validate.ts'

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures')

const fullJsDeck = readFileSync(path.join(fixtureDir, 'full-js-deck.html'), 'utf8')
const plainCssDeck = readFileSync(path.join(fixtureDir, 'plain-css-deck.html'), 'utf8')
const revealDeck = readFileSync(path.join(fixtureDir, 'reveal-deck.html'), 'utf8')

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
