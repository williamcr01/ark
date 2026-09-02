import { describe, expect, it } from 'vitest'

import { ARK_LOCKED_ATTR } from '@ark/deck/document/metadata.ts'
import { applyDeckPatches } from '../slide-ops.ts'
import { arkManagedDeck } from './test-decks.ts'

describe('lock_element and unlock_element', () => {
  it('locks and unlocks managed elements', () => {
    const locked = applyDeckPatches(arkManagedDeck, [
      {
        op: 'lock_element',
        slideIndex: 0,
        elementId: 'ark-el-title',
      },
    ])

    expect(locked.ok).toBe(true)
    if (!locked.ok) {
      return
    }

    expect(locked.html).toContain(`${ARK_LOCKED_ATTR}="true"`)

    const unlocked = applyDeckPatches(arkManagedDeck, [
      {
        op: 'unlock_element',
        slideIndex: 0,
        elementId: 'ark-el-locked',
      },
    ])

    expect(unlocked.ok).toBe(true)
    if (!unlocked.ok) {
      return
    }

    expect(unlocked.html).not.toContain('data-ark-id="ark-el-locked" data-ark-locked="true"')
  })
})
