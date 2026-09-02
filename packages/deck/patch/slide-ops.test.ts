import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ARK_SLIDE_ID_ATTR } from '@ark/deck/document/metadata.ts'
import { parseDeckDocument } from '../document/parser.ts'
import { applyDeckPatches, createDeckDomCache, resetDeckDomCache } from './slide-ops.ts'
import { validateDeckHtml } from '../validate/document.ts'
import { JSDOM } from 'jsdom'

function parseDeckHtml(html: string) {
  return parseDeckDocument(new JSDOM(html).window.document, html)
}

const deckJsdomParses = vi.hoisted(() => ({ count: 0 }))

vi.mock('jsdom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jsdom')>()

  class JSDOM extends actual.JSDOM {
    constructor(
      html?: ConstructorParameters<typeof actual.JSDOM>[0],
      options?: ConstructorParameters<typeof actual.JSDOM>[1],
    ) {
      super(html, options)
      if (typeof html === 'string' && /<html[\s>]/i.test(html)) {
        deckJsdomParses.count += 1
      }
    }
  }

  return { ...actual, JSDOM }
})

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../test/fixtures',
)

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
  const validation = validateDeckHtml(html, (source) => new JSDOM(source).window.document)
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

const sequentialDeck = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Sequential</title></head>
<body>
  <section class="slide">
    <div data-ark-id="ark-el-0" data-ark-managed="true" style="position:absolute;left:10px;top:10px;width:80px;height:40px">A</div>
    <div data-ark-id="ark-el-1" data-ark-managed="true" style="position:absolute;left:50px;top:10px;width:80px;height:40px">B</div>
  </section>
</body>
</html>`

const otherDeck = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Other</title></head>
<body>
  <section class="slide">
    <div data-ark-id="ark-el-other" data-ark-managed="true" style="position:absolute;left:10px;top:10px;width:80px;height:40px">Z</div>
  </section>
</body>
</html>`

describe('applyDeckPatches live JSDOM reuse', () => {
  beforeEach(() => {
    resetDeckDomCache()
    deckJsdomParses.count = 0
  })

  it('reuses the live JSDOM when the next HTML is the previous serialize', () => {
    const first = applyDeckPatches(sequentialDeck, [
      { op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.5, y: 0.5 },
    ])

    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }

    expect(deckJsdomParses.count).toBe(1)
    expect(first.html).toContain('left: 640px')
    expect(first.html).toMatch(/data-ark-id="ark-el-1"[^>]*left:50px/)

    const second = applyDeckPatches(first.html, [
      { op: 'move_element', elementId: 'ark-el-1', slideIndex: 0, x: 0.25, y: 0.25 },
    ])

    expect(second.ok).toBe(true)
    if (!second.ok) {
      return
    }

    expect(deckJsdomParses.count).toBe(1)
    expect(second.html).toContain('left: 640px')
    expect(second.html).toContain('left: 320px')
    expect(second.changedElementIds).toEqual(['ark-el-1'])
    expect(second.validation?.valid).toBe(true)
  })

  it('parses fresh on a restored or other-revision HTML string', () => {
    const first = applyDeckPatches(sequentialDeck, [
      { op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.5, y: 0.5 },
    ])

    expect(first.ok).toBe(true)
    expect(deckJsdomParses.count).toBe(1)

    const restored = applyDeckPatches(sequentialDeck, [
      { op: 'move_element', elementId: 'ark-el-1', slideIndex: 0, x: 0.25, y: 0.25 },
    ])

    expect(restored.ok).toBe(true)
    if (!restored.ok) {
      return
    }

    expect(deckJsdomParses.count).toBe(2)
    expect(restored.html).toContain('left: 320px')
    expect(restored.html).toMatch(/data-ark-id="ark-el-0"[^>]*left:10px/)
    expect(restored.html).not.toContain('left: 640px')
  })

  it('parses a different deck instead of mutating the cached window', () => {
    const first = applyDeckPatches(sequentialDeck, [
      { op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.5, y: 0.5 },
    ])

    expect(first.ok).toBe(true)
    expect(deckJsdomParses.count).toBe(1)

    const other = applyDeckPatches(otherDeck, [
      { op: 'move_element', elementId: 'ark-el-other', slideIndex: 0, x: 0.25, y: 0.25 },
    ])

    expect(other.ok).toBe(true)
    if (!other.ok) {
      return
    }

    expect(deckJsdomParses.count).toBe(2)
    expect(other.html).toContain('left: 320px')
    expect(other.html).toContain('ark-el-other')
    expect(other.html).not.toContain('ark-el-0')
    expect(other.html).not.toContain('left: 640px')
  })

  it('discards a mutated failed follow-up so the next source patch is clean', () => {
    const first = applyDeckPatches(sequentialDeck, [
      { op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.5, y: 0.5 },
    ])

    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }

    expect(deckJsdomParses.count).toBe(1)

    const failed = applyDeckPatches(first.html, [
      { op: 'move_element', elementId: 'ark-el-1', slideIndex: 0, x: 0.75, y: 0.75 },
      { op: 'move_element', elementId: 'ark-el-missing', slideIndex: 0, x: 0.1, y: 0.1 },
    ])

    expect(failed.ok).toBe(false)
    expect(deckJsdomParses.count).toBe(1)

    const retry = applyDeckPatches(first.html, [
      { op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.1, y: 0.1 },
    ])

    expect(retry.ok).toBe(true)
    if (!retry.ok) {
      return
    }

    expect(deckJsdomParses.count).toBe(2)
    expect(retry.html).toContain('left: 128px')
    expect(retry.html).toMatch(/data-ark-id="ark-el-1"[^>]*left:50px/)
    expect(retry.html).not.toContain('left: 960px')
    expect(retry.html).not.toContain('left: 640px')
  })

  it('content-addresses the cache across decks whose HTML matches the last serialize', () => {
    const first = applyDeckPatches(sequentialDeck, [
      { op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.5, y: 0.5 },
    ])

    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }

    const otherDeckSameHtml = `${first.html}`
    const second = applyDeckPatches(otherDeckSameHtml, [
      { op: 'move_element', elementId: 'ark-el-1', slideIndex: 0, x: 0.25, y: 0.25 },
    ])

    expect(second.ok).toBe(true)
    if (!second.ok) {
      return
    }

    expect(deckJsdomParses.count).toBe(1)
    expect(second.html).toContain('left: 640px')
    expect(second.html).toContain('left: 320px')
  })

  it('keeps an injected cache independent of the default instance', () => {
    const cache = createDeckDomCache()
    const first = applyDeckPatches(
      sequentialDeck,
      [{ op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.5, y: 0.5 }],
      { cache },
    )

    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }

    expect(deckJsdomParses.count).toBe(1)

    const second = applyDeckPatches(
      first.html,
      [{ op: 'move_element', elementId: 'ark-el-1', slideIndex: 0, x: 0.25, y: 0.25 }],
      { cache },
    )

    expect(second.ok).toBe(true)
    if (!second.ok) {
      return
    }

    expect(deckJsdomParses.count).toBe(1)

    const viaDefault = applyDeckPatches(second.html, [
      { op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.1, y: 0.1 },
    ])

    expect(viaDefault.ok).toBe(true)
    if (!viaDefault.ok) {
      return
    }

    expect(deckJsdomParses.count).toBe(2)
    cache.clear()
  })
})
