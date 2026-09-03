import '../install-test-constants.ts'
import { describe, expect, it } from 'vitest'

import { clampIndex, isRecord } from './values.ts'

describe('runtime-src shared values', () => {
  it('treats plain objects as records and rejects null', () => {
    expect(isRecord({ type: 'ark:deck-goto' })).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('goto')).toBe(false)
    expect(isRecord(1)).toBe(false)
  })

  it('clamps slide indexes onto the available range', () => {
    expect(clampIndex(-2, 5)).toBe(0)
    expect(clampIndex(2.9, 5)).toBe(2)
    expect(clampIndex(99, 5)).toBe(4)
    expect(clampIndex(1, 0)).toBe(0)
    expect(clampIndex(Number.NaN, 3)).toBe(0)
  })
})
