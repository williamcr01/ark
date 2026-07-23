import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { persistedChatMessageSchema } from '@ark/contracts'
import type { ChatMessagePart } from '@ark/deck-core/chat.ts'
import { assembleDeckAgentContext } from '@ark/deck-core/chat-context.ts'
import { extractAgentTranscriptParts } from './deck-agent.ts'
import { createActiveDeckTools } from './deck-tool-catalog.ts'
import { createDeckWorkspace } from './deck-workspace.ts'
import { persistAssistantGenerationMessage } from './chat-persistence.ts'
import { createChatStore } from './chat-store.ts'

describe('createChatStore', () => {
  let dataDir = ''

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
      dataDir = ''
    }
  })

  it('appends messages and reads them back in order with metadata preserved', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-chat-'))
    const store = createChatStore(dataDir)
    const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'
    const versionId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b55'

    await store.getOrCreateActiveThread(deckId, versionId)

    const first = await store.appendMessage(deckId, {
      id: '00000000-0000-4000-8000-000000000101',
      role: 'user',
      content: 'Make a deck',
      deckVersionId: versionId,
      attachments: [
        {
          type: 'file',
          mediaType: 'text/plain',
          filename: 'notes.txt',
          url: 'data:text/plain;base64,UTEgcmVzdWx0cw==',
        },
      ],
    })
    const second = await store.appendMessage(deckId, {
      id: '00000000-0000-4000-8000-000000000201',
      role: 'assistant',
      content: 'Generated the deck.',
      parts: [{ type: 'tool-call', toolName: 'write_deck', summary: 'Wrote deck HTML' }],
      generationJobId: '00000000-0000-4000-8000-000000000301',
      generationStatus: 'succeeded',
      model: 'openai:gpt-4.1-mini',
    })
    const duplicate = await store.appendMessage(deckId, {
      id: '00000000-0000-4000-8000-000000000201',
      role: 'assistant',
      content: 'Generated the deck.',
      generationJobId: '00000000-0000-4000-8000-000000000301',
      generationStatus: 'succeeded',
      model: 'openai:gpt-4.1-mini',
    })

    expect(first.attachments).toHaveLength(1)
    expect(second.parts).toHaveLength(1)
    expect(second.content).not.toContain('<!DOCTYPE html>')
    expect(duplicate.id).toBe(second.id)

    const listed = await store.listMessages(deckId)
    expect(listed.messages.map((message) => message.content)).toEqual([
      'Make a deck',
      'Generated the deck.',
    ])
    expect(listed.messages[1]).toMatchObject({
      generationJobId: '00000000-0000-4000-8000-000000000301',
      generationStatus: 'succeeded',
      model: 'openai:gpt-4.1-mini',
    })
  })

  it('persists model failures as failure text instead of a success fallback', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-chat-'))
    const store = createChatStore(dataDir)
    const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'

    await persistAssistantGenerationMessage(store, deckId, {
      jobId: '00000000-0000-4000-8000-000000000303',
      model: 'mock:model',
      status: 'failed',
      steps: [{ type: 'tool-result', toolName: 'read_deck', summary: 'Read the deck.' }],
      transcriptParts: [{ type: 'tool-result', toolName: 'read_deck', summary: 'Read the deck.' }],
      assistantText: '',
      editingExistingDeck: true,
      error: {
        message: 'The provider rejected the request.',
        code: 'provider_error',
        errorCategory: 'provider_error',
      },
    })

    const message = (await store.listMessages(deckId)).messages[0]
    expect(message.content).toBe(
      'The model failed to generate the deck. The provider rejected the request.',
    )
    expect(message.content).not.toContain('Updated the deck using tool calls')
    expect(message.parts?.at(-1)).toMatchObject({
      type: 'text',
      content: 'The model failed to generate the deck. The provider rejected the request.',
    })
  })

  it('persists and reloads a generated transcript within its durable ceiling', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-chat-'))
    const store = createChatStore(dataDir)
    const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'
    const parts = [
      ...Array.from({ length: 30 }, (_, stepIndex) => [
        {
          type: 'tool-call' as const,
          toolName: 'read_deck',
          summary: `read ${stepIndex}`,
          stepIndex,
          toolCallId: `call-${stepIndex}`,
          input: { offset: stepIndex + 1, padding: 'x'.repeat(20_000) },
        },
        {
          type: 'tool-result' as const,
          toolName: 'read_deck',
          summary: `result ${stepIndex}`,
          stepIndex,
          toolCallId: `call-${stepIndex}`,
          output: { content: 'y'.repeat(20_000) },
        },
      ]).flat(),
      { type: 'text' as const, content: 'z'.repeat(600_000), stepIndex: 30 },
    ] satisfies ChatMessagePart[]

    await persistAssistantGenerationMessage(store, deckId, {
      jobId: '00000000-0000-4000-8000-000000000301',
      model: 'mock:model',
      status: 'failed',
      steps: [],
      transcriptParts: parts,
      assistantText: 'z'.repeat(600_000),
      editingExistingDeck: true,
    })
    const message = (await store.listMessages(deckId)).messages[0]
    expect(message.parts).toHaveLength(parts.length + 1)
    expect(message.parts?.at(-1)?.content).toContain('I could not generate the deck yet.')
    expect(persistedChatMessageSchema.safeParse(message).success).toBe(true)
  })

  it('replays persisted recovery metadata in the next job context', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-chat-'))
    const store = createChatStore(dataDir)
    const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'
    const { activeDefinitions } = createActiveDeckTools(createDeckWorkspace('<html></html>'))
    const transcriptParts = extractAgentTranscriptParts(
      [
        {
          content: [
            {
              type: 'tool-call',
              toolName: 'read_deck',
              toolCallId: 'call-read',
              input: { offset: 1 },
            },
            {
              type: 'tool-result',
              toolName: 'read_deck',
              toolCallId: 'call-read',
              output: {
                mode: 'lines',
                content: 'x'.repeat(10_000),
                offset: 1,
                totalLines: 2,
                truncated: true,
                nextOffset: 2,
              },
            },
          ],
        },
      ],
      activeDefinitions,
    )
    await persistAssistantGenerationMessage(store, deckId, {
      jobId: '00000000-0000-4000-8000-000000000302',
      model: 'mock:model',
      status: 'failed',
      steps: [],
      transcriptParts,
      editingExistingDeck: true,
    })
    const stored = (await store.listMessages(deckId)).messages[0]
    const context = assembleDeckAgentContext({
      messages: [
        { role: 'assistant', content: stored.content, parts: stored.parts },
        { role: 'user', content: 'Continue' },
      ],
      currentHtml: '<html></html>',
    })
    expect(JSON.stringify(context.modelMessages)).toContain('nextOffset')
    expect(JSON.stringify(context.modelMessages)).toContain('Call read_deck')
  })

  it('returns empty history for decks without chat files', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-chat-'))
    const store = createChatStore(dataDir)

    const result = await store.listMessages('be4b3f4e-d05b-45d1-9da6-89d6df227b54')
    expect(result).toEqual({ thread: null, messages: [], hasMore: false })
  })

  it('clears active thread messages by deleting the chat file', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-chat-'))
    const store = createChatStore(dataDir)
    const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'

    await store.appendMessage(deckId, { role: 'user', content: 'hello' })

    expect(await store.clearThread(deckId)).toBe(true)
    expect(await store.listMessages(deckId)).toEqual({
      thread: null,
      messages: [],
      hasMore: false,
    })
    await expect(readFile(path.join(dataDir, `${deckId}.json`), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('returns false when clearing a deck with no chat file', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-chat-'))
    const store = createChatStore(dataDir)

    expect(await store.clearThread('be4b3f4e-d05b-45d1-9da6-89d6df227b54')).toBe(false)
  })

  it('throws when chat files are corrupt or truncated', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-chat-'))
    const store = createChatStore(dataDir)
    const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'

    await mkdir(dataDir, { recursive: true })
    await writeFile(path.join(dataDir, `${deckId}.json`), '{not valid json', 'utf8')

    await expect(store.listMessages(deckId)).rejects.toThrow(/^Corrupt chat history file/)
    await expect(store.appendMessage(deckId, { role: 'user', content: 'hello' })).rejects.toThrow(
      /^Corrupt chat history file/,
    )
  })

  it('throws when chat files have invalid structure', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-chat-'))
    const store = createChatStore(dataDir)
    const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'

    await mkdir(dataDir, { recursive: true })
    await writeFile(path.join(dataDir, `${deckId}.json`), JSON.stringify({ broken: true }), 'utf8')

    await expect(store.listMessages(deckId)).rejects.toThrow(/^Corrupt chat history file/)
  })

  it('rejects invalid deck ids before touching the filesystem', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-chat-'))
    const store = createChatStore(dataDir)

    expect(await store.listMessages('../escape')).toEqual({
      thread: null,
      messages: [],
      hasMore: false,
    })
    await expect(store.getOrCreateActiveThread('missing-id')).rejects.toThrow('Invalid deck id.')
    await expect(
      store.appendMessage('missing-id', { role: 'user', content: 'hello' }),
    ).rejects.toThrow('Invalid deck id.')
    expect(await store.clearThread('../../etc/passwd')).toBe(false)
  })
})
