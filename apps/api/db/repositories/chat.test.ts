import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { ConnectablePool } from '../client.ts'
import {
  createMigratedMemoryPostgresPool,
  stubStaticRuntimeManifest,
  truncateMemoryPostgresAppTables,
} from '../test-utils.ts'
import { createPostgresChatStore } from './chat.ts'
import { createPostgresDeckStore } from './decks.ts'

const fastOptions = { runtimeManifest: stubStaticRuntimeManifest }

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
  let pool: ConnectablePool
  let deckStore: ReturnType<typeof createPostgresDeckStore>
  let chatStore: ReturnType<typeof createPostgresChatStore>

  beforeAll(async () => {
    pool = await createMigratedMemoryPostgresPool()
    deckStore = createPostgresDeckStore({ pool, migrate: false })
    chatStore = createPostgresChatStore({ pool, migrate: false })
  })

  beforeEach(async () => {
    await truncateMemoryPostgresAppTables(pool)
  })

  afterAll(async () => {
    await pool.end?.()
  })

  it('creates a thread, appends messages in order, and paginates history', async () => {
    const deck = await deckStore.createDeck(sampleHtml, fastOptions)
    const thread = await chatStore.getOrCreateActiveThread(deck.id, deck.activeVersionId ?? null)

    expect(thread.deckId).toBe(deck.id)

    const first = await chatStore.appendMessage(deck.id, {
      id: '00000000-0000-4000-8000-000000000101',
      role: 'user',
      content: 'Make a deck',
      deckVersionId: deck.activeVersionId ?? null,
    })
    const second = await chatStore.appendMessage(deck.id, {
      id: '00000000-0000-4000-8000-000000000201',
      role: 'assistant',
      content: 'Generated the deck.',
      parts: [{ type: 'tool-call', toolName: 'write_deck', summary: 'Wrote deck HTML' }],
      generationJobId: '00000000-0000-4000-8000-000000000201',
      generationStatus: 'succeeded',
      model: 'openai:gpt-4.1-mini',
    })
    const duplicate = await chatStore.appendMessage(deck.id, {
      id: '00000000-0000-4000-8000-000000000201',
      role: 'assistant',
      content: 'Generated the deck.',
      generationJobId: '00000000-0000-4000-8000-000000000201',
      generationStatus: 'succeeded',
      model: 'openai:gpt-4.1-mini',
    })

    expect(first.content).toBe('Make a deck')
    expect(second.parts).toHaveLength(1)
    expect(second.content).not.toContain('<!DOCTYPE html>')
    expect(duplicate.id).toBe(second.id)

    const listed = await chatStore.listMessages(deck.id, { limit: 1 })

    expect(listed.hasMore).toBe(true)
    expect(listed.messages).toHaveLength(1)
    expect(listed.messages[0]?.id).toBe(second.id)

    const full = await chatStore.listMessages(deck.id)
    expect(full.messages.map((message) => message.content)).toEqual([
      'Make a deck',
      'Generated the deck.',
    ])

    // Clear is covered for both backends in store-contract; assert postgres path here once.
    expect(await chatStore.clearThread(deck.id)).toBe(true)
    expect(await chatStore.listMessages(deck.id)).toEqual({
      thread: null,
      messages: [],
      hasMore: false,
    })
  })

  it('returns empty history for missing decks', async () => {
    const result = await chatStore.listMessages('00000000-0000-4000-8000-000000000099')
    expect(result).toEqual({ thread: null, messages: [], hasMore: false })
  })
})
