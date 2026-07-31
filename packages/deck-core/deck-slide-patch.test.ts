// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import fullJsDeck from '@fixtures/full-js-deck.html?raw'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'
import revealChartDeck from '@fixtures/reveal-chart-deck.html?raw'
import revealRegistryDeck from '@fixtures/reveal-registry-deck.html?raw'
import revealVerticalDeck from '@fixtures/reveal-vertical-deck.html?raw'

import {
  createDeckSlideSnapshot,
  diffDeckSlideSnapshots,
  mapPreservedSlideIndex,
  resolvePatchActiveSlideIndex,
} from './deck-slide-patch.ts'

function snapshot(html: string) {
  const result = createDeckSlideSnapshot(html)

  if (!result) {
    throw new Error('Expected a patchable snapshot')
  }

  return result
}

function diff(previousHtml: string, nextHtml: string) {
  return diffDeckSlideSnapshots(snapshot(previousHtml), snapshot(nextHtml))
}

/** Apply an edit script the way the injected runtime does, for round-tripping. */
function applyOperations(slides: string[], patch: ReturnType<typeof diff>) {
  const list = [...slides]

  for (const operation of patch?.operations ?? []) {
    if (operation.op === 'remove') {
      list.splice(operation.index, 1)
      continue
    }

    list.splice(operation.index, 0, operation.html)
  }

  return list
}

describe('createDeckSlideSnapshot', () => {
  it('captures one entry per slide', () => {
    const result = snapshot(plainCssDeck)

    expect(result.slides).toHaveLength(3)
    expect(result.slides[0]).toContain('Quarterly planning')
    expect(result.skeleton).not.toContain('Quarterly planning')
  })

  it('strips deck scripts and inline handlers from slide markup', () => {
    const withScript = plainCssDeck.replace(
      '<h1>Quarterly planning</h1>',
      '<h1 onclick="steal()">Quarterly planning</h1><script>steal()</script>',
    )

    expect(snapshot(withScript).slides[0]).not.toContain('onclick')
    expect(snapshot(withScript).slides[0]).not.toContain('<script')
  })

  it('refuses decks that run their own scripts', () => {
    expect(createDeckSlideSnapshot(fullJsDeck)).toBeNull()
    expect(createDeckSlideSnapshot(revealChartDeck)).toBeNull()
  })

  it('refuses reveal decks whose slides do not share one parent', () => {
    expect(createDeckSlideSnapshot(revealVerticalDeck)).toBeNull()
  })

  it('refuses empty decks', () => {
    expect(createDeckSlideSnapshot('')).toBeNull()
    expect(
      createDeckSlideSnapshot('<!DOCTYPE html><html><body><p>no slides</p></body></html>'),
    ).toBeNull()
  })
})

describe('diffDeckSlideSnapshots', () => {
  it('reports no operations when nothing changed', () => {
    expect(diff(plainCssDeck, plainCssDeck)?.operations).toEqual([])
  })

  it('swaps only the edited slide in place', () => {
    const edited = plainCssDeck.replace('Metrics that moved', 'Metrics that mattered')
    const patch = diff(plainCssDeck, edited)

    expect(patch?.slideCount).toBe(3)
    expect(patch?.operations).toEqual([
      { op: 'remove', index: 1 },
      { op: 'insert', index: 1, html: expect.stringContaining('Metrics that mattered') },
    ])
    expect(patch?.slideIndexMap).toEqual([0, -1, 2])
    expect(applyOperations(snapshot(plainCssDeck).slides, patch)).toEqual(snapshot(edited).slides)
  })

  it('inserts an appended slide without touching the others', () => {
    const extended = plainCssDeck.replace(
      '</body>',
      '<section class="slide" data-title="Extra"><h2>One more thing</h2></section></body>',
    )
    const patch = diff(plainCssDeck, extended)

    expect(patch?.slideCount).toBe(4)
    expect(patch?.operations).toEqual([
      { op: 'insert', index: 3, html: expect.stringContaining('One more thing') },
    ])
    expect(patch?.slideIndexMap).toEqual([0, 1, 2])
    expect(applyOperations(snapshot(plainCssDeck).slides, patch)).toEqual(snapshot(extended).slides)
  })

  it('removes a deleted slide without touching the others', () => {
    const trimmed = plainCssDeck.replace(
      /<section class="slide" data-title="Metrics">[\s\S]*?<\/section>/,
      '',
    )
    const patch = diff(plainCssDeck, trimmed)

    expect(patch?.operations).toEqual([{ op: 'remove', index: 1 }])
    expect(patch?.slideIndexMap).toEqual([0, -1, 1])
    expect(applyOperations(snapshot(plainCssDeck).slides, patch)).toEqual(snapshot(trimmed).slides)
  })

  it('round-trips a reordered deck', () => {
    const previous = snapshot(plainCssDeck)
    const reordered = {
      skeleton: previous.skeleton,
      slides: [previous.slides[2]!, previous.slides[0]!, previous.slides[1]!],
    }
    const patch = diffDeckSlideSnapshots(previous, reordered)

    expect(applyOperations(previous.slides, patch)).toEqual(reordered.slides)
  })

  it('patches approved reveal decks', () => {
    const previous = snapshot(revealRegistryDeck)

    expect(previous.slides.length).toBeGreaterThan(1)

    const edited = revealRegistryDeck.replace(
      previous.slides[0]!.includes('</h1>') ? '</h1>' : '</h2>',
      ' — updated</h1>',
    )

    expect(diff(revealRegistryDeck, edited)?.operations.length).toBeGreaterThan(0)
  })

  it('requires a reload when anything outside the slides changed', () => {
    const restyled = plainCssDeck.replace('background: white;', 'background: black;')

    expect(diff(plainCssDeck, restyled)).toBeNull()
  })

  it('requires a reload when the title changed', () => {
    const retitled = plainCssDeck.replace('<title>Plain CSS Deck</title>', '<title>Renamed</title>')

    expect(diff(plainCssDeck, retitled)).toBeNull()
  })
})

describe('mapPreservedSlideIndex', () => {
  it('follows a surviving slide when an earlier slide is inserted', () => {
    const previous = snapshot(plainCssDeck).slides
    const next = [previous[0]!, '<section class="slide">New</section>', previous[1]!, previous[2]!]

    expect(mapPreservedSlideIndex(previous, next, 1)).toBe(2)
    expect(mapPreservedSlideIndex(previous, next, 2)).toBe(3)
  })

  it('follows a surviving slide when an earlier slide is deleted', () => {
    const previous = snapshot(plainCssDeck).slides
    const next = [previous[1]!, previous[2]!]

    expect(mapPreservedSlideIndex(previous, next, 2)).toBe(1)
  })

  it('falls back to the same number when the active slide was replaced', () => {
    const previous = snapshot(plainCssDeck).slides
    const next = [previous[0]!, '<section class="slide">Replaced</section>', previous[2]!]

    expect(mapPreservedSlideIndex(previous, next, 1)).toBe(1)
  })

  it('resolves the active index from a patch map', () => {
    const edited = plainCssDeck.replace('Metrics that moved', 'Metrics that mattered')
    const patch = diff(plainCssDeck, edited)!

    expect(resolvePatchActiveSlideIndex(patch, 2)).toBe(2)
    expect(resolvePatchActiveSlideIndex(patch, 1)).toBe(1)
  })
})
