/** @vitest-environment jsdom */

import './install-test-constants.ts'
import { describe, expect, it } from 'vitest'

import { closestSnap } from './snap.ts'

describe('closestSnap', () => {
  it('returns the nearest target within the threshold', () => {
    const snap = closestSnap([0.48], [0, 0.5, 1], 0.05)
    expect(snap).not.toBeNull()
    expect(snap!.target).toBe(0.5)
    expect(snap!.difference).toBeCloseTo(0.02)
  })

  it('returns null when nothing is close enough', () => {
    expect(closestSnap([0.2], [0.5, 1], 0.05)).toBeNull()
  })
})
