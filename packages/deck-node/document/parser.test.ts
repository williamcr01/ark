import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { parseDeckDocument } from '@ark/deck/document/parser.ts'
import { JSDOM } from 'jsdom'

import { parseDeckHtml } from './parser.ts'

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../test/fixtures',
)

const plainCssDeck = readFileSync(path.join(fixtureDir, 'plain-css-deck.html'), 'utf8')

describe('parseDeckHtml', () => {
  it('returns an empty parse result for blank HTML without constructing a document', () => {
    const parsed = parseDeckHtml('   ')

    expect(parsed.slideCount).toBe(0)
    expect(parsed.slides).toEqual([])
    expect(parsed.editableElements).toEqual([])
    expect(parsed.styles).toEqual([])
    expect(parsed.scripts).toEqual([])
    expect(parsed.assets).toEqual([])
  })

  it('delegates populated HTML to parseDeckDocument', () => {
    const parsed = parseDeckHtml(plainCssDeck)
    const fromDocument = parseDeckDocument(new JSDOM(plainCssDeck).window.document, plainCssDeck)

    expect(parsed).toEqual(fromDocument)
    expect(parsed.title).toBe('Plain CSS Deck')
    expect(parsed.slideCount).toBe(3)
  })
})
