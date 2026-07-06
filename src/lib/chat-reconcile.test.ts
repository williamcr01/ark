import { describe, expect, it } from 'vitest'

import { reconcileChatMessages } from '@/lib/chat-reconcile'

describe('reconcileChatMessages', () => {
  it('keeps local-only messages that never reached the server', () => {
    const local = [
      { id: 'm1', role: 'user' as const, content: 'hello' },
      { id: 'm2', role: 'assistant' as const, content: 'unsynced' },
    ]
    const server = [{ id: 'm1', role: 'user' as const, content: 'hello' }]

    const { messages, failedIds } = reconcileChatMessages(local, server)

    expect(messages).toEqual([
      { id: 'm1', role: 'user', content: 'hello' },
      { id: 'm2', role: 'assistant', content: 'unsynced' },
    ])
    expect(failedIds).toEqual(new Set(['m2']))
  })

  it('appends server-only messages after the reconciled local order', () => {
    const local = [{ id: 'm1', role: 'user' as const, content: 'hello' }]
    const server = [
      { id: 'm1', role: 'user' as const, content: 'hello' },
      { id: 'm3', role: 'assistant' as const, content: 'from server' },
    ]

    const { messages, failedIds } = reconcileChatMessages(local, server)

    expect(messages).toEqual([
      { id: 'm1', role: 'user', content: 'hello' },
      { id: 'm3', role: 'assistant', content: 'from server' },
    ])
    expect(failedIds).toEqual(new Set())
  })
})
