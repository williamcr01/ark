import { describe, expect, it } from 'vitest'

import { useChatStore } from './chat-store.ts'

describe('useChatStore', () => {
  it('appendMessage and replaceMessages update the thread', () => {
    useChatStore.getState().reset()
    useChatStore.getState().appendMessage({ id: 'm1', role: 'user', content: 'hello' })
    expect(useChatStore.getState().messages).toEqual([{ id: 'm1', role: 'user', content: 'hello' }])

    useChatStore
      .getState()
      .replaceMessages((current) => [...current, { id: 'm2', role: 'assistant', content: 'hi' }])
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual(['m1', 'm2'])
  })

  it('hydrateThread swaps the visible deck thread atomically', () => {
    useChatStore.getState().reset()
    useChatStore.getState().appendMessage({ id: 'old', role: 'user', content: 'stale' })
    useChatStore.getState().hydrateThread({
      trackedDeckId: 'deck-2',
      messagesDeckId: 'deck-2',
      messages: [{ id: 'm2', role: 'user', content: 'deck two' }],
      failedPersistIds: new Set(),
      deliveryStatus: new Map(),
      isLoading: true,
    })

    const state = useChatStore.getState()
    expect(state.trackedDeckId).toBe('deck-2')
    expect(state.messages[0]?.content).toBe('deck two')
    expect(state.isLoading).toBe(true)
  })

  it('enqueue/dequeue send queue preserves insertion order', () => {
    useChatStore.getState().reset()
    useChatStore.getState().enqueueSend({
      id: 'a',
      text: 'first',
      attachments: [],
      assetIds: [],
    })
    useChatStore.getState().enqueueSend({
      id: 'b',
      text: 'second',
      attachments: [],
      assetIds: [],
    })
    useChatStore.getState().moveSendToFront('b')
    expect(useChatStore.getState().queuedSends.map((item) => item.id)).toEqual(['b', 'a'])

    expect(useChatStore.getState().dequeueNextSend()?.id).toBe('b')
    expect(useChatStore.getState().dequeueSend('a')?.text).toBe('first')
    expect(useChatStore.getState().queuedSends).toEqual([])
  })

  it('markDeliveryStatus tracks failed persists', () => {
    useChatStore.getState().reset()
    useChatStore.getState().appendMessage({ id: 'm1', role: 'user', content: 'hello' })
    useChatStore.getState().markDeliveryStatus('m1', 'saving')
    expect(useChatStore.getState().deliveryStatus.get('m1')).toBe('saving')

    useChatStore.getState().markDeliveryStatus('m1', 'failed')
    expect(useChatStore.getState().failedPersistIds.has('m1')).toBe(true)

    useChatStore.getState().markDeliveryStatus('m1', 'saved')
    expect(useChatStore.getState().failedPersistIds.has('m1')).toBe(false)
    expect(useChatStore.getState().deliveryStatus.get('m1')).toBe('saved')
  })

  it('dismissError clears attachment and generation errors', () => {
    useChatStore.getState().reset()
    useChatStore.getState().setAttachmentError('bad file')
    useChatStore.getState().setGenerationError('failed')
    useChatStore.getState().setWorkspaceError('upload')
    useChatStore.getState().dismissError()
    expect(useChatStore.getState().attachmentError).toBe('')
    expect(useChatStore.getState().generationError).toBe('')
    expect(useChatStore.getState().workspaceError).toBe('')
  })
})
