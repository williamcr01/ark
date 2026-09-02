import { describe, expect, it } from 'vitest'

import { resetAllStores } from './index.ts'
import { useChatStore } from './chat-store.ts'
import { useDeckStore } from './deck-store.ts'
import { useShellStore } from './shell-store.ts'

describe('resetAllStores', () => {
  it('restores registered stores to their initial state', () => {
    useDeckStore.getState().setHtml('<p>dirty</p>')
    useChatStore.getState().setInput('queued prompt')
    useShellStore.getState().setChatOpen(true)

    resetAllStores()

    expect(useDeckStore.getState().html).toBe('')
    expect(useChatStore.getState().input).toBe('')
    expect(useShellStore.getState().isChatOpen).toBe(false)
  })
})
