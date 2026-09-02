/** @vitest-environment jsdom */

import '../install-test-constants.ts'
import { describe, expect, it } from 'vitest'

import { applySlidePatch } from './slide-patch.ts'
import { findSlides } from './slides.ts'

describe('runtime-src slide-patch applier', () => {
  it('inserts, removes, and reports the live slide count', () => {
    document.body.innerHTML =
      '<section class="slide">One</section><section class="slide">Two</section>'

    expect(findSlides()).toHaveLength(2)
    expect(
      applySlidePatch([
        {
          op: 'insert',
          index: 1,
          html: '<section class="slide">Inserted</section>',
        },
      ]),
    ).toBe(3)
    expect(findSlides().map((slide) => slide.textContent)).toEqual(['One', 'Inserted', 'Two'])

    expect(applySlidePatch([{ op: 'remove', index: 0 }])).toBe(2)
    expect(findSlides().map((slide) => slide.textContent)).toEqual(['Inserted', 'Two'])
  })

  it('returns null when an operation misses the live list', () => {
    document.body.innerHTML = '<section class="slide">Only</section>'

    expect(applySlidePatch([{ op: 'remove', index: 4 }])).toBeNull()
    expect(findSlides()).toHaveLength(1)
  })
})
