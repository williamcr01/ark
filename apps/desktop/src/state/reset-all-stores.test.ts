import { describe, expect, it } from 'vitest'

import { resetAllStores } from './index.ts'
import { useChatStore } from './chat-store.ts'
import { useDeckStore } from './deck-store.ts'
import { useEditorStore } from './editor-store.ts'
import { useModelsStore } from './models-store.ts'
import { useShellStore } from './shell-store.ts'

describe('resetAllStores', () => {
  it('restores every domain store to its initial state', () => {
    useDeckStore.getState().setHtml('<p>dirty</p>')
    useChatStore.getState().setInput('queued prompt')
    useEditorStore.getState().setStripOpen(false)
    useShellStore.getState().setChatOpen(true)
    useModelsStore.getState().setError('boom')

    resetAllStores()

    expect(useDeckStore.getState().html).toBe('')
    expect(useChatStore.getState().input).toBe('')
    expect(useEditorStore.getState().isStripOpen).toBe(true)
    expect(useShellStore.getState().isChatOpen).toBe(false)
    expect(useModelsStore.getState().error).toBe('')
  })
})
