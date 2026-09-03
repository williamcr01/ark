import '../install-test-constants.ts'
import { describe, expect, it } from 'vitest'

import { readGotoIndex, readSlidePatchCommand } from './message.ts'

describe('runtime-src message parsing', () => {
  it('reads a parent goto index and rejects malformed payloads', () => {
    expect(readGotoIndex({ type: 'ark:deck-goto', index: 2 })).toBe(2)
    expect(readGotoIndex({ type: 'ark:deck-goto', index: '2' })).toBeNull()
    expect(readGotoIndex({ type: 'ark:deck-ready', index: 0 })).toBeNull()
    expect(readGotoIndex(null)).toBeNull()
  })

  it('reads a slide-patch command without requiring index', () => {
    expect(
      readSlidePatchCommand({
        type: 'ark:deck-patch-slides',
        patchId: 'p1',
        operations: [{ op: 'remove', index: 0 }],
        index: 1,
      }),
    ).toEqual({
      operations: [{ op: 'remove', index: 0 }],
      patchId: 'p1',
      index: 1,
    })
    expect(
      readSlidePatchCommand({
        type: 'ark:deck-patch-slides',
        patchId: 'p2',
        operations: [],
      }),
    ).toEqual({ operations: [], patchId: 'p2', index: undefined })
    expect(readSlidePatchCommand({ type: 'ark:deck-goto', index: 0 })).toBeNull()
    expect(readSlidePatchCommand({ type: 'ark:deck-patch-slides', operations: 'nope' })).toBeNull()
  })
})
