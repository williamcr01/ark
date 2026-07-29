import { describe, expect, it } from 'vitest'

import {
  buildSlideContexts,
  extractSlideIdFromOuterHtml,
  extractSlideTitleFromOuterHtml,
  resolveContextSlides,
  sameContextSlideEntries,
  toggleContextSlideEntry,
} from './slide-context'

describe('slide-context helpers', () => {
  it('extracts slide titles from headings and comments', () => {
    expect(extractSlideTitleFromOuterHtml('<section><h1>Market overview</h1></section>', 0)).toBe(
      'Market overview',
    )
    expect(
      extractSlideTitleFromOuterHtml('<!-- slide: Agenda --><section><p>Hi</p></section>', 1),
    ).toBe('Agenda')
    expect(extractSlideTitleFromOuterHtml('<section><p>Hi</p></section>', 2)).toBe('Slide 3')
  })

  it('extracts slide ids when present', () => {
    expect(
      extractSlideIdFromOuterHtml('<section data-ark-slide-id="ark-slide-9">Hi</section>'),
    ).toBe('ark-slide-9')
    expect(extractSlideIdFromOuterHtml('<section>Hi</section>')).toBeUndefined()
  })

  it('toggles slide entries and enforces the max cap', () => {
    const slides = [
      { index: 0, outerHTML: '<section data-ark-slide-id="a"><h2>One</h2></section>' },
      { index: 1, outerHTML: '<section data-ark-slide-id="b"><h2>Two</h2></section>' },
      { index: 2, outerHTML: '<section><h2>Three</h2></section>' },
    ]

    const added = toggleContextSlideEntry([], 0, slides, 2)
    expect(added).toEqual({
      capped: false,
      entries: [{ slideIndex: 0, slideId: 'a' }],
    })

    const second = toggleContextSlideEntry(added.entries, 1, slides, 2)
    expect(second.entries).toHaveLength(2)
    expect(second.capped).toBe(false)

    const capped = toggleContextSlideEntry(second.entries, 2, slides, 2)
    expect(capped).toEqual({ capped: true, entries: second.entries })

    const removed = toggleContextSlideEntry(second.entries, 0, slides, 2)
    expect(removed).toEqual({
      capped: false,
      entries: [{ slideIndex: 1, slideId: 'b' }],
    })
  })

  it('re-resolves attached slides by id after reorder and drops vanished ids', () => {
    const before = [
      { slideIndex: 0, slideId: 'a' },
      { slideIndex: 1, slideId: 'b' },
      { slideIndex: 2 },
    ]
    const reordered = [
      { index: 0, outerHTML: '<section data-ark-slide-id="b"><h2>Two</h2></section>' },
      { index: 1, outerHTML: '<section data-ark-slide-id="a"><h2>One</h2></section>' },
    ]

    expect(resolveContextSlides(before, reordered)).toEqual([
      { slideIndex: 0, slideId: 'b' },
      { slideIndex: 1, slideId: 'a' },
    ])
  })

  it('compares resolved entry lists', () => {
    expect(
      sameContextSlideEntries([{ slideIndex: 0, slideId: 'a' }], [{ slideIndex: 0, slideId: 'a' }]),
    ).toBe(true)
    expect(
      sameContextSlideEntries([{ slideIndex: 0, slideId: 'a' }], [{ slideIndex: 1, slideId: 'a' }]),
    ).toBe(false)
  })

  it('builds ordered slide contexts for selected entries', () => {
    const slides = [
      { index: 0, outerHTML: '<section data-ark-slide-id="a"><h2>One</h2></section>' },
      { index: 1, outerHTML: '<section><h2>Two</h2></section>' },
      { index: 2, outerHTML: '<section><p>Three</p></section>' },
    ]

    expect(
      buildSlideContexts([{ slideIndex: 2 }, { slideIndex: 0, slideId: 'a' }], slides),
    ).toEqual([
      { slideIndex: 0, slideId: 'a', title: 'One' },
      { slideIndex: 2, title: 'Slide 3' },
    ])
  })

  it('omits indexes that do not match a slide', () => {
    const slides = [{ index: 0, outerHTML: '<section><h2>One</h2></section>' }]
    expect(buildSlideContexts([{ slideIndex: 0 }, { slideIndex: 4 }], slides)).toEqual([
      { slideIndex: 0, title: 'One' },
    ])
  })
})
