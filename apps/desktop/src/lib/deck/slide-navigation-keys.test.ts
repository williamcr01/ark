import { describe, expect, it } from 'vitest'

import {
  clampSlideIndex,
  getPresentKeyboardTargetIndex,
  getPreviewKeyboardTargetIndex,
} from './slide-navigation-keys.ts'

describe('slide-navigation-keys', () => {
  it('clamps indexes into the deck range', () => {
    expect(clampSlideIndex(Number.NaN, 3)).toBe(0)
    expect(clampSlideIndex(-2, 3)).toBe(0)
    expect(clampSlideIndex(9, 3)).toBe(2)
    expect(clampSlideIndex(1.8, 3)).toBe(1)
  })

  it('maps preview and present keyboard targets', () => {
    expect(getPreviewKeyboardTargetIndex('ArrowRight', 0, 3)).toBe(1)
    expect(getPreviewKeyboardTargetIndex('ArrowLeft', 0, 3)).toBe(0)
    expect(getPreviewKeyboardTargetIndex('Enter', 0, 3)).toBeNull()
    expect(getPresentKeyboardTargetIndex(' ', 1, 3)).toBe(2)
    expect(getPresentKeyboardTargetIndex('Home', 2, 3)).toBe(0)
    expect(getPresentKeyboardTargetIndex('End', 0, 3)).toBe(2)
  })
})
