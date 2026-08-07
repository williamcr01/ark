import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_READ_MAX_BYTES,
  listDeckSlides,
  readDeckCharacterSlice,
  readDeckHtmlSlice,
  readDeckSlideHtml,
  summarizeDeckHtml,
  syncDeckHtmlTitle,
} from './deck-html.ts'

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures')

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

  it('stops at complete lines before the 50KB byte limit', () => {
    const html = `${'a'.repeat(30_000)}\n${'b'.repeat(30_000)}\nlast`
    const page = readDeckHtmlSlice(html)
    expect(page.content).toBe('a'.repeat(30_000))
    expect(Buffer.byteLength(page.content, 'utf8')).toBeLessThanOrEqual(DEFAULT_READ_MAX_BYTES)
    expect(page.nextOffset).toBe(2)
  })

  it('uses UTF-8-safe character paging for one oversized line', () => {
    const html = 'å'.repeat(30_000)
    const first = readDeckHtmlSlice(html)
    expect(first.nextCharOffset).toBeDefined()
    expect(Buffer.byteLength(first.content, 'utf8')).toBeLessThanOrEqual(DEFAULT_READ_MAX_BYTES)
    expect(first.content.endsWith('å')).toBe(true)
    const second = readDeckCharacterSlice(html, {
      offset: 1,
      charOffset: first.nextCharOffset,
    })
    expect(first.content + second.content).toBe(html)
  })

  it('bounds a huge slide with a recoverable character offset', () => {
    const html = `<html><body><section class="slide">${'x'.repeat(80_000)}</section></body></html>`
    const page = readDeckSlideHtml(html, 0)
    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.truncated).toBe(true)
    expect(page.nextCharOffset).toBeDefined()
    expect(page.hint).toContain('slideIndex: 0')
  })
})

describe('summarizeDeckHtml', () => {
  it('mentions slide count for valid decks', () => {
    expect(summarizeDeckHtml(plainCssDeck)).toContain('slide')
  })
})

describe('syncDeckHtmlTitle', () => {
  it('replaces the document title and preserves opening-tag attributes', () => {
    const html =
      '<!DOCTYPE html><html><head><title data-x="1">Old</title></head><body></body></html>'

    expect(syncDeckHtmlTitle(html, 'Board plan')).toBe(
      '<!DOCTYPE html><html><head><title data-x="1">Board plan</title></head><body></body></html>',
    )
  })

  it('escapes HTML-sensitive characters in the title', () => {
    const html = '<html><head><title>Old</title></head><body></body></html>'

    expect(syncDeckHtmlTitle(html, 'Q3 <Plan> & "Review"')).toBe(
      '<html><head><title>Q3 &lt;Plan&gt; &amp; "Review"</title></head><body></body></html>',
    )
  })

  it('inserts a title into the head when the document has none', () => {
    const html = '<html><head><meta charset="utf-8"></head><body></body></html>'

    expect(syncDeckHtmlTitle(html, 'Board plan')).toBe(
      '<html><head><title>Board plan</title><meta charset="utf-8"></head><body></body></html>',
    )
  })

  it('leaves html without a head or title unchanged', () => {
    const html = '<html><body><section class="slide"></section></body></html>'

    expect(syncDeckHtmlTitle(html, 'Board plan')).toBe(html)
  })
})
