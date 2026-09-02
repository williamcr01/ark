import { describe, expect, it } from 'vitest'

import { resetAllStores } from './index.ts'
import { useDeckStore } from './deck-store.ts'
import { useShellStore } from './shell-store.ts'

describe('resetAllStores', () => {
  it('restores registered stores to their initial state', () => {
    useDeckStore.getState().setHtml('<p>dirty</p>')
    useShellStore.getState().setChatOpen(true)

    resetAllStores()

    expect(useDeckStore.getState().html).toBe('')
    expect(useShellStore.getState().isChatOpen).toBe(false)
  })
})
