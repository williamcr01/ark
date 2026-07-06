import { describe, expect, it } from 'vitest'

import { isTextEditableSelection } from './deck-text-edit'

describe('isTextEditableSelection', () => {
  it('returns true for unlocked text elements', () => {
    expect(
      isTextEditableSelection({
        elementId: 'el-1',
        slideIndex: 0,
        slideId: null,
        tagName: 'h1',
        locked: false,
        textPreview: 'Title',
      }),
    ).toBe(true)
  })

  it('returns false for locked elements', () => {
    expect(
      isTextEditableSelection({
        elementId: 'el-1',
        slideIndex: 0,
        slideId: null,
        tagName: 'h1',
        locked: true,
        textPreview: 'Title',
      }),
    ).toBe(false)
  })

  it('returns false for non-text tags', () => {
    expect(
      isTextEditableSelection({
        elementId: 'el-1',
        slideIndex: 0,
        slideId: null,
        tagName: 'img',
        locked: false,
        textPreview: null,
      }),
    ).toBe(false)
  })
})
