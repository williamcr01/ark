import { describe, expect, it } from 'vitest'

import { applyDeckPatches } from '../slide-ops.ts'
import { arkManagedDeck } from './test-decks.ts'

describe('replace_text', () => {
  it('replaces text on a managed element', () => {
    const result = applyDeckPatches(arkManagedDeck, [
      {
        op: 'replace_text',
        slideId: 'ark-slide-title',
        elementId: 'ark-el-title',
        text: 'Updated opening',
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.html).toContain('Updated opening')
    expect(result.changedSlideIndexes).toEqual([0])
    expect(result.changedElementIds).toContain('ark-el-title')
  })

  it('rejects a no-op text replacement', () => {
    expect(
      applyDeckPatches(arkManagedDeck, [
        {
          op: 'replace_text',
          slideIndex: 0,
          elementId: 'ark-el-title',
          text: 'Opening',
        },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('did not change') })
  })
})
