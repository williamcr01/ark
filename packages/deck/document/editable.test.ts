import { describe, expect, it } from 'vitest'

import { isInlineTextEditableTag } from './editable.ts'

describe('deck editable text tags', () => {
  it('recognizes supported inline text tags', () => {
    expect(isInlineTextEditableTag('h1')).toBe(true)
    expect(isInlineTextEditableTag('P')).toBe(true)
    expect(isInlineTextEditableTag('span')).toBe(true)
  })

  it('rejects non-text tags', () => {
    expect(isInlineTextEditableTag('img')).toBe(false)
    expect(isInlineTextEditableTag('svg')).toBe(false)
    expect(isInlineTextEditableTag('button')).toBe(false)
  })
})
