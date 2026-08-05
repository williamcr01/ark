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
        managed: false,
        editableKind: null,
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
        managed: false,
        editableKind: null,
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
        managed: false,
        editableKind: null,
        textPreview: null,
      }),
    ).toBe(false)
  })

  it('returns true for Ark-managed text boxes', () => {
    expect(
      isTextEditableSelection({
        elementId: 'el-1',
        slideIndex: 0,
        slideId: null,
        tagName: 'div',
        locked: false,
        managed: true,
        editableKind: 'text-box',
        textPreview: 'New text',
      }),
    ).toBe(true)
  })
})
