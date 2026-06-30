import { afterEach, describe, expect, it } from 'vitest'

import { getTestLocalStorage } from '@/test/storage'

import {
  clearChatSession,
  createChatSession,
  readChatSession,
  writeChatSession,
} from './chat-session'

describe('chat-session storage', () => {
  afterEach(() => {
    clearChatSession()
  })

  it('round-trips chat messages', () => {
    const session = {
      ...createChatSession(),
      messages: [
        { id: 'u1', role: 'user' as const, content: 'Make a deck' },
        { id: 'a1', role: 'assistant' as const, content: 'Generated the deck.' },
      ],
    }

    writeChatSession(session)

    const restored = readChatSession()
    expect(restored?.messages).toEqual(session.messages)
    expect(restored?.updatedAt).toBeTruthy()
  })

  it('migrates messages from the legacy deck-session key', () => {
    getTestLocalStorage().setItem(
      'ark:deck-session',
      JSON.stringify({
        id: 'legacy',
        html: '<html></html>',
        messages: [{ id: 'm1', role: 'user', content: 'hello' }],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    )

    expect(readChatSession()?.messages).toEqual([
      { id: 'm1', role: 'user', content: 'hello' },
    ])
  })

  it('returns null for invalid stored payloads', () => {
    getTestLocalStorage().setItem('ark:chat-session', '{"messages":"nope"}')
    expect(readChatSession()).toBeNull()
  })
})
