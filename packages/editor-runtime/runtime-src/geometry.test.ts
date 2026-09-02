/** @vitest-environment jsdom */

import './install-test-constants.ts'
import { describe, expect, it } from 'vitest'

import { clampRect, clampUnit } from './geometry.ts'

describe('geometry clamping', () => {
  it('clamps units onto the 0–1 slide range', () => {
    expect(clampUnit(-0.2)).toBe(0)
    expect(clampUnit(0.4)).toBe(0.4)
    expect(clampUnit(2)).toBe(1)
    expect(clampUnit(Number.NaN)).toBe(0)
  })

  it('keeps a rect inside the slide and at least MIN_BOX_SIZE', () => {
    expect(clampRect({ x: -0.2, y: 0.9, width: 0.01, height: 0.5 })).toEqual({
      x: 0,
      y: 0.5,
      width: 0.04,
      height: 0.5,
    })
  })
})
