import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { persistAssistantGenerationMessage } from '../records/chat-persistence.ts'
import { createChatStore } from './chat-store.ts'
import { createDeckStore } from './deck-store.ts'
import { createWorkspaceStore, type WorkspaceStore } from './workspace-store.ts'

const html = '<!DOCTYPE html><html><head><title>Chat</title></head><body></body></html>'

describe('createChatStore', () => {
  let directory = ''
  let workspaces: WorkspaceStore | null = null

  afterEach(async () => {
    workspaces?.close()
    workspaces = null
    if (directory) await rm(directory, { recursive: true, force: true })
    directory = ''
  })

  async function setup() {
    directory = await mkdtemp(path.join(os.tmpdir(), 'ark-chat-'))
    workspaces = createWorkspaceStore(directory)
    const deck = await createDeckStore(workspaces).createDeck(html)
    return { deck, store: createChatStore(workspaces) }
  }

  it('appends messages in order with document metadata', async () => {
    const { deck, store } = await setup()
    const first = await store.appendMessage(deck.id, {
      id: '00000000-0000-4000-8000-000000000101',
      role: 'user',
      content: 'Make a deck',
      context: { slideContexts: [{ slideIndex: 0, title: 'Intro' }] },
    })
    await store.appendMessage(deck.id, {
      id: '00000000-0000-4000-8000-000000000201',
      role: 'assistant',
      content: 'Done',
      model: 'openai:gpt-4.1-mini',
    })

    expect(first.documentRevision).toBe(1)
    expect((await store.listMessages(deck.id)).messages).toEqual([
      expect.objectContaining({ content: 'Make a deck' }),
      expect.objectContaining({ content: 'Done', model: 'openai:gpt-4.1-mini' }),
    ])
  })

  it('makes repeated message ids idempotent for persistence retries', async () => {
    const { deck, store } = await setup()
    const input = {
      id: '00000000-0000-4000-8000-000000000101',
      role: 'user' as const,
      content: 'Retry me',
    }
    const first = await store.appendMessage(deck.id, input)
    const duplicate = await store.appendMessage(deck.id, input)
    expect(duplicate).toEqual(first)
    expect((await store.listMessages(deck.id)).messages).toHaveLength(1)
  })

  it('persists model failure details as an assistant message', async () => {
    const { deck, store } = await setup()
    await persistAssistantGenerationMessage(store, deck.id, {
      jobId: '00000000-0000-4000-8000-000000000303',
      model: 'mock:model',
      status: 'failed',
      steps: [],
      transcriptParts: [],
      assistantText: '',
      editingExistingDeck: true,
      error: {
        message: 'The provider rejected the request.',
        code: 'provider_error',
        errorCategory: 'provider_error',
      },
    })
    expect((await store.listMessages(deck.id)).messages[0]?.content).toContain(
      'The provider rejected the request.',
    )
  })

  it('creates, updates, archives, and deletes threads', async () => {
    const { deck, store } = await setup()
    const thread = await store.createThread(deck.id, 'Design')
    await expect(
      store.updateThread(deck.id, thread.id, { title: 'Visuals', visibility: 'shared' }),
    ).resolves.toMatchObject({ title: 'Visuals', visibility: 'shared' })
    await expect(store.updateThread(deck.id, thread.id, { archived: true })).resolves.toMatchObject(
      {
        status: 'archived',
      },
    )
    await expect(store.deleteThread(deck.id, thread.id)).resolves.toBe(true)
  })

  it('clears the active thread and leaves no active transcript', async () => {
    const { deck, store } = await setup()
    await store.appendMessage(deck.id, { role: 'user', content: 'hello' })
    await expect(store.clearThread(deck.id)).resolves.toBe(true)
    await expect(store.listMessages(deck.id)).resolves.toEqual({
      thread: null,
      messages: [],
      hasMore: false,
    })
  })

  it('rejects invalid and missing workspace ids', async () => {
    const { store } = await setup()
    await expect(store.listMessages('../escape')).rejects.toThrow('Invalid deck id.')
    await expect(store.listMessages('be4b3f4e-d05b-45d1-9da6-89d6df227b54')).rejects.toThrow(
      'Deck not found.',
    )
  })
})
