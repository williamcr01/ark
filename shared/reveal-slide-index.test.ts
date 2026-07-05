import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  flattenRevealSlideElements,
  flattenRevealSlideElementsFromRoot,
  hasRevealSlideStructure,
  revealHVToLinearIndex,
  revealLinearIndexToHV,
  revealSlideCountFromRoot,
  revealSlideToLinearIndex,
} from './reveal-slide-index'

const horizontalOnlyReveal = `<!DOCTYPE html>
<html>
<body>
  <div class="reveal">
    <div class="slides">
      <section><h1>One</h1></section>
      <section><h2>Two</h2></section>
    </div>
  </div>
</body>
</html>`

const verticalReveal = `<!DOCTYPE html>
<html>
<body>
  <div class="reveal">
    <div class="slides">
      <section><h1>Opening</h1></section>
      <section>
        <section><h2>Vertical one</h2></section>
        <section><h2>Vertical two</h2></section>
      </section>
      <section><h2>Closing</h2></section>
    </div>
  </div>
</body>
</html>`

const malformedReveal = `<!DOCTYPE html>
<html>
<body>
  <div class="reveal">
    <div class="slides"></div>
  </div>
</body>
</html>`

function parseReveal(html: string) {
  return new JSDOM(html).window.document
}

describe('reveal slide index mapping', () => {
  it('detects reveal slide structure', () => {
    const doc = parseReveal(horizontalOnlyReveal)

    expect(hasRevealSlideStructure(doc)).toBe(true)
    expect(revealSlideCountFromRoot(doc)).toBe(2)
  })

  it('flattens horizontal-only reveal decks in order', () => {
    const doc = parseReveal(horizontalOnlyReveal)
    const slides = flattenRevealSlideElementsFromRoot(doc)

    expect(slides).toHaveLength(2)
    expect(slides[0]?.textContent).toContain('One')
    expect(slides[1]?.textContent).toContain('Two')
  })

  it('flattens vertical slide stacks into a deterministic linear order', () => {
    const doc = parseReveal(verticalReveal)
    const slides = flattenRevealSlideElementsFromRoot(doc)

    expect(slides).toHaveLength(4)
    expect(slides.map((slide) => slide.textContent?.trim())).toEqual([
      'Opening',
      'Vertical one',
      'Vertical two',
      'Closing',
    ])
  })

  it('maps linear indexes to reveal h/v coordinates and back', () => {
    const doc = parseReveal(verticalReveal)
    const slidesContainer = doc.querySelector('.reveal .slides')

    expect(slidesContainer).not.toBeNull()

    const container = slidesContainer as ParentNode

    expect(revealLinearIndexToHV(container, 0)).toEqual({ h: 0, v: 0 })
    expect(revealLinearIndexToHV(container, 1)).toEqual({ h: 1, v: 0 })
    expect(revealLinearIndexToHV(container, 2)).toEqual({ h: 1, v: 1 })
    expect(revealLinearIndexToHV(container, 3)).toEqual({ h: 2, v: 0 })

    expect(revealHVToLinearIndex(container, { h: 1, v: 1 })).toBe(2)
    expect(revealSlideToLinearIndex(container, flattenRevealSlideElements(container)[2]!)).toBe(2)
  })

  it('returns empty results for malformed reveal structures', () => {
    const doc = parseReveal(malformedReveal)

    expect(flattenRevealSlideElementsFromRoot(doc)).toEqual([])
    expect(revealSlideCountFromRoot(doc)).toBe(0)
    expect(revealLinearIndexToHV(doc.querySelector('.slides') as ParentNode, 0)).toBeNull()
  })
})
