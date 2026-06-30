import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { listDeckSlides, readDeckHtmlSlice, summarizeDeckHtml } from './deck-html.ts'

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/test/fixtures',
)

const plainCssDeck = readFileSync(path.join(fixtureDir, 'plain-css-deck.html'), 'utf8')

describe('listDeckSlides', () => {
  it('returns slide summaries for a valid deck', () => {
    const slides = listDeckSlides(plainCssDeck)

    expect(slides.length).toBeGreaterThan(0)
    expect(slides[0]).toMatchObject({
      index: 0,
      title: expect.any(String),
    })
  })
})

describe('readDeckHtmlSlice', () => {
  it('pages through deck HTML by line offset', () => {
    const firstPage = readDeckHtmlSlice(plainCssDeck, { offset: 1, limit: 5 })
    const secondPage = readDeckHtmlSlice(plainCssDeck, { offset: 6, limit: 5 })

    expect(firstPage.content.split('\n').length).toBeLessThanOrEqual(5)
    expect(secondPage.offset).toBe(6)
  })
})

describe('summarizeDeckHtml', () => {
  it('mentions slide count for valid decks', () => {
    expect(summarizeDeckHtml(plainCssDeck)).toContain('slide')
  })
})
