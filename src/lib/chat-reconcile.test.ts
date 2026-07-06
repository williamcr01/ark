import { describe, expect, it } from 'vitest'

import { reconcileChatMessages } from '@/lib/chat-reconcile'

describe('reconcileChatMessages', () => {
  it('keeps only explicitly failed local-only messages', () => {
    const local = [
      { id: 'm1', role: 'user' as const, content: 'hello' },
      { id: 'm2', role: 'assistant' as const, content: 'unsynced' },
    ]
    const server = [{ id: 'm1', role: 'user' as const, content: 'hello' }]

    const { messages, failedIds } = reconcileChatMessages(local, server, ['m2'])

    expect(messages).toEqual([
      { id: 'm1', role: 'user', content: 'hello' },
      { id: 'm2', role: 'assistant', content: 'unsynced' },
    ])
    expect(failedIds).toEqual(new Set(['m2']))
  })

  it('does not resurrect stale cached messages missing from the server', () => {
    const local = [
      { id: 'm1', role: 'user' as const, content: 'old cache' },
      { id: 'm2', role: 'assistant' as const, content: 'also stale' },
    ]
    const server: typeof local = []

    const { messages, failedIds } = reconcileChatMessages(local, server)

    expect(messages).toEqual([])
    expect(failedIds).toEqual(new Set())
  })

  it('drops known failed ids once the server has them', () => {
    const local = [{ id: 'm1', role: 'user' as const, content: 'local copy' }]
    const server = [{ id: 'm1', role: 'user' as const, content: 'server copy' }]

    const { messages, failedIds } = reconcileChatMessages(local, server, ['m1'])

    expect(messages).toEqual([{ id: 'm1', role: 'user', content: 'server copy' }])
    expect(failedIds).toEqual(new Set())
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
