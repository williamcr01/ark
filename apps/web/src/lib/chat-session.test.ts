import { afterEach, describe, expect, it } from 'vitest'

import { getTestLocalStorage } from '@/test/storage'

import {
  clearChatSession,
  createChatSession,
  getChatSessionStorageKey,
  readChatSession,
  writeChatSession,
} from './chat-session'

describe('chat-session storage', () => {
  afterEach(() => {
    clearChatSession(null)
    clearChatSession('deck-1')
  })

  it('round-trips chat messages per deck', () => {
    const session = {
      ...createChatSession(),
      messages: [
        { id: 'u1', role: 'user' as const, content: 'Make a deck' },
        { id: 'a1', role: 'assistant' as const, content: 'Generated the deck.' },
      ],
    }

    writeChatSession('deck-1', session)

    const restored = readChatSession('deck-1')
    expect(restored?.messages).toEqual(session.messages)
    expect(restored?.updatedAt).toBeTruthy()
    expect(getTestLocalStorage().getItem(getChatSessionStorageKey('deck-1'))).toBeTruthy()
  })

  it('keeps new-deck chat separate from saved decks', () => {
    writeChatSession(null, {
      ...createChatSession(),
      messages: [{ id: 'n1', role: 'user', content: 'new deck prompt' }],
    })
    writeChatSession('deck-1', {
      ...createChatSession(),
      messages: [{ id: 'd1', role: 'user', content: 'saved deck prompt' }],
    })

    expect(readChatSession(null)?.messages[0]?.content).toBe('new deck prompt')
    expect(readChatSession('deck-1')?.messages[0]?.content).toBe('saved deck prompt')
  })

  it('migrates messages from the legacy deck-session key for new decks', () => {
    getTestLocalStorage().setItem(
      'ark:deck-session',
      JSON.stringify({
        id: 'legacy',
        html: '<html></html>',
        messages: [{ id: 'm1', role: 'user', content: 'hello' }],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    )

    expect(readChatSession(null)?.messages).toEqual([{ id: 'm1', role: 'user', content: 'hello' }])
  })

  it('round-trips failed persist ids for saved decks', () => {
    const session = {
      ...createChatSession(),
      messages: [{ id: 'm1', role: 'user' as const, content: 'hello' }],
      failedPersistIds: ['m1'],
    }

    writeChatSession('deck-1', session)

    expect(readChatSession('deck-1')?.failedPersistIds).toEqual(['m1'])
  })

  it('returns null for invalid stored payloads', () => {
    getTestLocalStorage().setItem(getChatSessionStorageKey('deck-1'), '{"messages":"nope"}')
    expect(readChatSession('deck-1')).toBeNull()
  })
})
