import { describe, expect, it } from 'vitest'

import {
  buildSlideContexts,
  extractSlideIdFromOuterHtml,
  extractSlideTitleFromOuterHtml,
  filterValidSlideIndexes,
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

  it('filters out-of-range slide indexes', () => {
    expect(filterValidSlideIndexes([0, 2, 5, -1], 3)).toEqual([0, 2])
    expect(filterValidSlideIndexes([1, 2], 0)).toEqual([])
  })

  it('builds ordered slide contexts for selected indexes', () => {
    const slides = [
      { index: 0, outerHTML: '<section data-ark-slide-id="a"><h2>One</h2></section>' },
      { index: 1, outerHTML: '<section><h2>Two</h2></section>' },
      { index: 2, outerHTML: '<section><p>Three</p></section>' },
    ]

    expect(buildSlideContexts([2, 0], slides)).toEqual([
      { slideIndex: 0, slideId: 'a', title: 'One' },
      { slideIndex: 2, title: 'Slide 3' },
    ])
  })

  it('omits indexes that do not match a slide', () => {
    const slides = [{ index: 0, outerHTML: '<section><h2>One</h2></section>' }]
    expect(buildSlideContexts([0, 4], slides)).toEqual([{ slideIndex: 0, title: 'One' }])
  })
})
