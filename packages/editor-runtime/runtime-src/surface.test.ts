import { describe, expect, it } from 'vitest'

import { colorSurface, compositeColor } from './surface.ts'

describe('surface color math', () => {
  it('composites a semi-transparent foreground over an opaque background', () => {
    const result = compositeColor({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 })

    expect(result.a).toBeCloseTo(1)
    expect(result.r).toBeCloseTo(127.5)
    expect(result.g).toBeCloseTo(127.5)
    expect(result.b).toBeCloseTo(127.5)
  })

  it('classifies luminance as light or dark', () => {
    expect(colorSurface({ r: 250, g: 250, b: 250, a: 1 })).toBe('light')
    expect(colorSurface({ r: 10, g: 10, b: 10, a: 1 })).toBe('dark')
  })
})
