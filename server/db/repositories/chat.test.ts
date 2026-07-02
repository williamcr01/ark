import { describe, expect, it } from 'vitest'

import { createMemoryPostgresPool } from '../test-utils.ts'
import { createPostgresChatStore } from './chat.ts'
import { createPostgresDeckStore } from './decks.ts'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Quarterly Review</title>
</head>
<body>
  <section class="slide"><h1>Hello</h1></section>
</body>
</html>`

describe('createPostgresChatStore', () => {
  it('creates a thread, appends messages in order, and paginates history', async () => {
    const pool = createMemoryPostgresPool()
    const deckStore = createPostgresDeckStore({ pool })
    const chatStore = createPostgresChatStore({ pool })

    try {
      const deck = await deckStore.createDeck(sampleHtml)
      const thread = await chatStore.getOrCreateActiveThread(deck.id, deck.activeVersionId ?? null)

      expect(thread.deckId).toBe(deck.id)

      const first = await chatStore.appendMessage(deck.id, {
        id: '00000000-0000-4000-8000-000000000101',
        role: 'user',
        content: 'Make a deck',
        deckVersionId: deck.activeVersionId ?? null,
      })
      const second = await chatStore.appendMessage(deck.id, {
        role: 'assistant',
        content: 'Generated the deck.',
        parts: [{ type: 'tool-call', toolName: 'write_deck', summary: 'Wrote deck HTML' }],
        generationJobId: '00000000-0000-4000-8000-000000000201',
        generationStatus: 'succeeded',
        model: 'openai:gpt-4.1-mini',
      })

      expect(first.content).toBe('Make a deck')
      expect(second.parts).toHaveLength(1)
      expect(second.content).not.toContain('<!DOCTYPE html>')

      const listed = await chatStore.listMessages(deck.id, { limit: 1 })

      expect(listed.hasMore).toBe(true)
      expect(listed.messages).toHaveLength(1)
      expect(listed.messages[0]?.id).toBe(second.id)

      const full = await chatStore.listMessages(deck.id)
      expect(full.messages.map((message) => message.content)).toEqual([
        'Make a deck',
        'Generated the deck.',
      ])
    } finally {
      await pool.end?.()
    }
  })

  it('returns empty history for missing decks', async () => {
    const pool = createMemoryPostgresPool()
    const chatStore = createPostgresChatStore({ pool })

    try {
      const result = await chatStore.listMessages('00000000-0000-4000-8000-000000000099')
      expect(result).toEqual({ thread: null, messages: [], hasMore: false })
    } finally {
      await pool.end?.()
    }
  })

  it('clears active thread messages', async () => {
    const pool = createMemoryPostgresPool()
    const deckStore = createPostgresDeckStore({ pool })
    const chatStore = createPostgresChatStore({ pool })

    try {
      const deck = await deckStore.createDeck(sampleHtml)
      await chatStore.appendMessage(deck.id, { role: 'user', content: 'hello' })

      expect(await chatStore.clearThread(deck.id)).toBe(true)
      expect(await chatStore.listMessages(deck.id)).toEqual({
        thread: null,
        messages: [],
        hasMore: false,
      })
    } finally {
      await pool.end?.()
    }
  })
})
