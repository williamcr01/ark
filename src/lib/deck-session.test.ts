import { afterEach, describe, expect, it } from 'vitest'

import {
  clearDeckSession,
  createDeckSession,
  readDeckSession,
  writeDeckSession,
} from './deck-session'

describe('deck-session storage', () => {
  afterEach(() => {
    clearDeckSession()
  })

  it('round-trips html and chat messages', () => {
    const session = {
      ...createDeckSession(),
      html: '<html><body><section class="slide">Hi</section></body></html>',
      messages: [
        { id: 'u1', role: 'user' as const, content: 'Make a deck' },
        { id: 'a1', role: 'assistant' as const, content: 'Generated the deck.' },
      ],
    }

    writeDeckSession(session)

    const restored = readDeckSession()
    expect(restored?.id).toBe(session.id)
    expect(restored?.html).toBe(session.html)
    expect(restored?.messages).toEqual(session.messages)
    expect(restored?.updatedAt).toBeTruthy()
  })

  it('returns null for invalid stored payloads', () => {
    localStorage.setItem('ark:deck-session', '{"id":"x"}')
    expect(readDeckSession()).toBeNull()
  })
})
