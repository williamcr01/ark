import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { extractHtmlDocument, finalizeGeneratedDeck } from './generate-response.ts'

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures')

const plainCssDeck = readFileSync(path.join(fixtureDir, 'plain-css-deck.html'), 'utf8')
const malformedDeck = readFileSync(path.join(fixtureDir, 'malformed-deck.html'), 'utf8')

describe('extractHtmlDocument', () => {
  it('unwraps fenced HTML responses', () => {
    expect(
      extractHtmlDocument('```html\n<!DOCTYPE html><html><body></body></html>\n```'),
    ).toContain('<!DOCTYPE html>')
  })
})

describe('finalizeGeneratedDeck', () => {
  it('returns html and a validation report for valid model output', () => {
    const result = finalizeGeneratedDeck(plainCssDeck)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.html).toContain('<html')
      expect(result.validation.valid).toBe(true)
      expect(result.validation.slideCount).toBeGreaterThan(0)
    }
  })

  it('rejects malformed decks with a validation report', () => {
    const result = finalizeGeneratedDeck(malformedDeck)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.validation.valid).toBe(false)
      expect(result.error.length).toBeGreaterThan(0)
    }
  })
})
