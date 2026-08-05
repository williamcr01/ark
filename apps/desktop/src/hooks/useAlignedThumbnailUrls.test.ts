import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { alignThumbnailUrls, useAlignedThumbnailUrls } from './useAlignedThumbnailUrls'

function createDeck(contents: string[]) {
  return {
    slides: contents.map((content, index) => ({
      index,
      outerHTML: `<section>${content}</section>`,
    })),
  }
}

describe('alignThumbnailUrls', () => {
  it('follows slide content through a reorder', () => {
    const anchor = createDeck(['a', 'b', 'c'])
    const reordered = createDeck(['b', 'c', 'a'])

    expect(alignThumbnailUrls(anchor, ['/a.png', '/b.png', '/c.png'], reordered)).toEqual([
      '/b.png',
      '/c.png',
      '/a.png',
    ])
  })

  it('keeps the same-index url for slides whose content changed in place', () => {
    const anchor = createDeck(['a', 'b'])
    const edited = createDeck(['a', 'b-edited'])

    expect(alignThumbnailUrls(anchor, ['/a.png', '/b.png'], edited)).toEqual(['/a.png', '/b.png'])
  })

  it('consumes duplicate-content matches once each', () => {
    const anchor = createDeck(['a', 'a', 'b'])
    const reordered = createDeck(['b', 'a', 'a'])

    expect(alignThumbnailUrls(anchor, ['/a1.png', '/a2.png', '/b.png'], reordered)).toEqual([
      '/b.png',
      '/a1.png',
      '/a2.png',
    ])
  })
})

describe('useAlignedThumbnailUrls', () => {
  it('re-aligns stale urls when the deck changes and passes fresh urls through', () => {
    const initialDeck = createDeck(['a', 'b', 'c'])
    const initialUrls = ['/a.png', '/b.png', '/c.png']
    const { rerender, result } = renderHook(
      ({ deck, urls }: { deck: ReturnType<typeof createDeck>; urls: (string | null)[] | null }) =>
        useAlignedThumbnailUrls(deck, urls),
      { initialProps: { deck: initialDeck, urls: initialUrls } },
    )

    expect(result.current).toBe(initialUrls)

    // Slide 1 moved to the end; urls are still the anchored (stale) array.
    const reorderedDeck = createDeck(['b', 'c', 'a'])
    rerender({ deck: reorderedDeck, urls: initialUrls })
    expect(result.current).toEqual(['/b.png', '/c.png', '/a.png'])

    // The renderer catches up with urls for the new version: use them as-is.
    const freshUrls = ['/b2.png', '/c2.png', '/a2.png']
    rerender({ deck: reorderedDeck, urls: freshUrls })
    expect(result.current).toBe(freshUrls)

    // The fresh urls become the anchor for the next deck change.
    rerender({ deck: createDeck(['c', 'b', 'a']), urls: freshUrls })
    expect(result.current).toEqual(['/c2.png', '/b2.png', '/a2.png'])
  })

  it('returns null while no urls are available', () => {
    const { rerender, result } = renderHook(
      ({ deck, urls }: { deck: ReturnType<typeof createDeck>; urls: (string | null)[] | null }) =>
        useAlignedThumbnailUrls(deck, urls),
      { initialProps: { deck: createDeck(['a']), urls: null as (string | null)[] | null } },
    )

    expect(result.current).toBeNull()

    rerender({ deck: createDeck(['b']), urls: null })
    expect(result.current).toBeNull()
  })
})
