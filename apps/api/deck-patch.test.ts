import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ARK_SLIDE_ID_ATTR } from '@ark/deck-core/deck-metadata.ts'
import { applyDeckPatches } from './deck-patch.ts'
import { parseDeckHtml } from './deck-parser.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures')

const plainCssDeck = readFileSync(path.join(fixtureDir, 'plain-css-deck.html'), 'utf8')
const revealDeck = readFileSync(path.join(fixtureDir, 'reveal-deck.html'), 'utf8')

const deckWithNotes = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Notes Deck</title>
  <style>section.slide { width: 100vw; height: 100vh; }</style>
</head>
<body>
  <section class="slide" data-ark-slide-id="ark-slide-open">
    <h1>Opening</h1>
    <aside class="notes">Remember the roadmap.</aside>
  </section>
  <section class="slide" data-ark-slide-id="ark-slide-metrics" data-notes="Keep this short.">
    <h2>Metrics</h2>
  </section>
</body>
</html>`

function expectValidDeck(html: string) {
  const validation = validateDeckHtmlOnServer(html)
  expect(validation.valid).toBe(true)
  return validation
}

describe('applyDeckPatches', () => {
  it('adds a slide with a generated slide id and element ids', () => {
    const result = applyDeckPatches(plainCssDeck, [
      {
        op: 'add_slide',
        afterIndex: 0,
        html: '<section class="slide"><h2>Inserted</h2><p>More detail</p></section>',
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expectValidDeck(result.html)
    const parsed = parseDeckHtml(result.html)
    expect(parsed.slideCount).toBe(4)
    expect(parsed.slides[1]?.title).toBe('Inserted')
    expect(parsed.slides[1]?.slideId).toMatch(/^ark-slide-/)
    expect(result.changedSlideIndexes).toEqual([1])
    expect(result.changedElementIds.length).toBeGreaterThan(0)
    expect(result.summary).toContain('Added slide')

    const insertedElements = parsed.editableElements[1]?.elements ?? []
    expect(insertedElements.some((element) => element.id.startsWith('ark-el-'))).toBe(true)
  })

  it('deletes, replaces, and reorders slides by index or id', () => {
    const deleted = applyDeckPatches(plainCssDeck, [{ op: 'delete_slide', slideIndex: 2 }], {
      activeSlideIndex: 2,
    })

    expect(deleted.ok).toBe(true)
    if (!deleted.ok) {
      return
    }

    expect(parseDeckHtml(deleted.html).slideCount).toBe(2)
    expect(deleted.suggestedActiveSlideIndex).toBe(1)

    const replaced = applyDeckPatches(deleted.html, [
      {
        op: 'replace_slide',
        slideIndex: 0,
        html: '<section class="slide" data-ark-slide-id="ark-slide-custom"><h1>Replaced title</h1></section>',
      },
    ])

    expect(replaced.ok).toBe(true)
    if (!replaced.ok) {
      return
    }

    expect(parseDeckHtml(replaced.html).slides[0]?.title).toBe('Replaced title')

    const reordered = applyDeckPatches(replaced.html, [
      { op: 'reorder_slide', slideIndex: 1, toIndex: 0 },
    ])

    expect(reordered.ok).toBe(true)
    if (!reordered.ok) {
      return
    }

    expect(parseDeckHtml(reordered.html).slides[0]?.title).toBe('Metrics that moved')
  })

  it('updates slide titles and notes', () => {
    const titled = applyDeckPatches(deckWithNotes, [
      { op: 'update_slide_title', slideId: 'ark-slide-open', title: 'Kickoff' },
      { op: 'update_slide_notes', slideIndex: 1, notes: 'Updated notes.' },
    ])

    expect(titled.ok).toBe(true)
    if (!titled.ok) {
      return
    }

    const parsed = parseDeckHtml(titled.html)
    expect(parsed.slides[0]?.title).toBe('Kickoff')
    expect(parsed.slides[1]?.notes).toBe('Updated notes.')
  })

  it('supports reveal-style decks', () => {
    const result = applyDeckPatches(revealDeck, [
      {
        op: 'add_slide',
        html: '<section><h2>Added reveal slide</h2></section>',
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(parseDeckHtml(result.html).slideCount).toBe(3)
    expectValidDeck(result.html)
  })

  it('falls back to exact text replacement operations', () => {
    const titleMatch = plainCssDeck.match(/Quarterly planning/)?.[0]
    expect(titleMatch).toBeTruthy()

    const result = applyDeckPatches(plainCssDeck, [
      { op: 'text_replace', oldText: titleMatch!, newText: 'Annual planning' },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.html).toContain('Annual planning')
  })

  it('rejects stale slide ids, invalid indexes, and unsafe element ops', () => {
    expect(
      applyDeckPatches(plainCssDeck, [{ op: 'delete_slide', slideId: 'missing-slide' }]),
    ).toMatchObject({ ok: false })

    expect(applyDeckPatches(plainCssDeck, [{ op: 'delete_slide', slideIndex: 9 }])).toMatchObject({
      ok: false,
    })

    expect(
      applyDeckPatches(plainCssDeck, [{ op: 'replace_text', elementId: 'ark-el-1', text: 'Nope' }]),
    ).toMatchObject({ ok: false, operationIndex: 0 })

    expect(applyDeckPatches(plainCssDeck, [{ op: 'delete_slide', slideIndex: 0 }])).toMatchObject({
      ok: true,
    })

    const singleSlideDeck = plainCssDeck.replace(
      /<section class="slide" data-title="Metrics">[\s\S]*?<\/section>\s*<section class="slide" data-title="Close">[\s\S]*?<\/section>/,
      '',
    )

    expect(
      applyDeckPatches(singleSlideDeck, [{ op: 'delete_slide', slideIndex: 0 }]),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('last slide'),
    })
  })

  it('preserves slide ids on replace when the replacement omits them', () => {
    const withId = plainCssDeck.replace(
      '<section class="slide" data-title="Opening">',
      `<section class="slide" data-title="Opening" ${ARK_SLIDE_ID_ATTR}="ark-slide-opening">`,
    )

    const result = applyDeckPatches(withId, [
      {
        op: 'replace_slide',
        slideId: 'ark-slide-opening',
        html: '<section class="slide"><h1>Fresh opening</h1></section>',
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(parseDeckHtml(result.html).slides[0]?.slideId).toBe('ark-slide-opening')
  })
})
