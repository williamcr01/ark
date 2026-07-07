import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { parseDeckHtml, summarizeParsedDeck, toDeckSlideSummaries } from './deck-parser.ts'

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures')

const plainCssDeck = readFileSync(path.join(fixtureDir, 'plain-css-deck.html'), 'utf8')
const revealDeck = readFileSync(path.join(fixtureDir, 'reveal-deck.html'), 'utf8')
const revealVerticalDeck = readFileSync(path.join(fixtureDir, 'reveal-vertical-deck.html'), 'utf8')
const fullJsDeck = readFileSync(path.join(fixtureDir, 'full-js-deck.html'), 'utf8')
const hostileScriptsDeck = readFileSync(path.join(fixtureDir, 'hostile-scripts-deck.html'), 'utf8')

const deckWithNotes = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Notes Deck</title>
  <style>section.slide { width: 100vw; height: 100vh; }</style>
</head>
<body>
  <section class="slide">
    <h1>Opening</h1>
    <aside class="notes">Remember to mention the roadmap.</aside>
  </section>
  <section class="slide" data-notes="Keep this slide under 30 seconds.">
    <h2>Metrics</h2>
  </section>
</body>
</html>`

describe('parseDeckHtml', () => {
  it('parses title, runtime, slides, styles, scripts, and assets for plain decks', () => {
    const parsed = parseDeckHtml(plainCssDeck)

    expect(parsed.title).toBe('Plain CSS Deck')
    expect(parsed.structure).toBe('plain')
    expect(parsed.runtime.previewMode).toBe('css-only')
    expect(parsed.slideSelector).toBe('section.slide')
    expect(parsed.slideCount).toBe(3)
    expect(parsed.slides[0]).toMatchObject({
      index: 0,
      title: 'Quarterly planning',
      preview: expect.stringContaining('Quarterly planning'),
      notes: null,
      slideId: 'transient-slide-0',
      slideIdTransient: true,
    })
    expect(parsed.styles).toHaveLength(1)
    expect(parsed.styles[0]?.inline).toBe(true)
    expect(parsed.styles[0]?.content).toContain('section.slide')
    expect(parsed.scripts).toHaveLength(0)
    expect(parsed.assets).toHaveLength(0)
  })

  it('recognizes reveal-style deck structure', () => {
    const parsed = parseDeckHtml(revealDeck)

    expect(parsed.structure).toBe('reveal')
    expect(parsed.slideSelector).toBe('.slides > section')
    expect(parsed.slideCount).toBe(2)
    expect(parsed.slides[0]?.title).toBe('Reveal opening')
    expect(parsed.slides[1]?.title).toBe('Reveal detail')
  })

  it('flattens reveal vertical slide stacks for parser metadata', () => {
    const parsed = parseDeckHtml(revealVerticalDeck)

    expect(parsed.structure).toBe('reveal')
    expect(parsed.slideCount).toBe(4)
    expect(parsed.slides.map((slide) => slide.title)).toEqual([
      'Opening',
      'Vertical one',
      'Vertical two',
      'Closing',
    ])
  })

  it('extracts speaker notes from aside, data-notes, and comments', () => {
    const parsed = parseDeckHtml(deckWithNotes)

    expect(parsed.slides[0]?.notes).toBe('Remember to mention the roadmap.')
    expect(parsed.slides[1]?.notes).toBe('Keep this slide under 30 seconds.')
  })

  it('detects full-js runtime markers and inline scripts', () => {
    const parsed = parseDeckHtml(fullJsDeck)

    expect(parsed.runtime.previewMode).toBe('full-js')
    expect(parsed.runtime.arkDeck).toBe('nav')
    expect(parsed.scripts).toHaveLength(1)
    expect(parsed.scripts[0]).toMatchObject({
      inline: true,
      contentLength: expect.any(Number),
    })
  })

  it('collects asset references from slides', () => {
    const parsed = parseDeckHtml(hostileScriptsDeck)

    expect(parsed.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'img',
          url: 'missing.png',
          slideIndex: 0,
        }),
      ]),
    )
    expect(parsed.scripts.length).toBeGreaterThanOrEqual(2)
  })

  it('returns an empty parse result for blank HTML', () => {
    const parsed = parseDeckHtml('   ')

    expect(parsed.slideCount).toBe(0)
    expect(parsed.slides).toEqual([])
    expect(parsed.editableElements).toEqual([])
    expect(parsed.styles).toEqual([])
    expect(parsed.scripts).toEqual([])
    expect(parsed.assets).toEqual([])
  })

  it('returns editableElements grouped by slide', () => {
    const parsed = parseDeckHtml(plainCssDeck)

    expect(parsed.editableElements).toHaveLength(parsed.slideCount)
    expect(parsed.editableElements[0]?.elements.length).toBeGreaterThan(0)
  })
})

describe('summarizeParsedDeck', () => {
  it('includes structure, slide outline, and runtime in the summary', () => {
    const summary = summarizeParsedDeck(parseDeckHtml(plainCssDeck))

    expect(summary).toContain('Plain CSS Deck')
    expect(summary).toContain('plain structure')
    expect(summary).toContain('3 slide(s)')
    expect(summary).toContain('css-only preview')
  })

  it('flags slides that have speaker notes', () => {
    const summary = summarizeParsedDeck(parseDeckHtml(deckWithNotes))

    expect(summary).toContain('[notes]')
  })
})

describe('toDeckSlideSummaries', () => {
  it('projects parser slides into list_slides summaries', () => {
    const summaries = toDeckSlideSummaries(parseDeckHtml(revealDeck))

    expect(summaries).toEqual([
      expect.objectContaining({ index: 0, title: 'Reveal opening' }),
      expect.objectContaining({ index: 1, title: 'Reveal detail' }),
    ])
  })
})
