import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createAssetStore } from './asset-store.ts'
import { createChatStore } from './chat-store.ts'
import { createDeckStore } from './deck-store.ts'
import { createGenerationJobStore } from './generation-job-store.ts'
import { createWorkspaceStore, type WorkspaceStore } from './workspace-store.ts'

const sampleHtml = `<!DOCTYPE html><html><head><title>Quarterly Review</title></head><body><section class="slide"><h1>Hello</h1></section></body></html>`

describe('Ark workspace store contract', () => {
  let root: string | null = null
  let workspaces: WorkspaceStore | null = null

  afterEach(async () => {
    workspaces?.close()
    workspaces = null
    if (root) await rm(root, { recursive: true, force: true })
    root = null
  })

  async function stores() {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-workspace-contract-'))
    workspaces = createWorkspaceStore(root)
    return {
      deckStore: createDeckStore(workspaces),
      chatStore: createChatStore(workspaces),
      assetStore: createAssetStore(workspaces),
    }
  }

  it('creates one .ark file and updates its document in place', async () => {
    const { deckStore } = await stores()
    const created = await deckStore.createDeck(sampleHtml)
    const updated = await deckStore.updateDeck(created.id, sampleHtml.replace('Hello', 'Updated'), {
      expectedDocumentRevision: created.documentRevision,
    })

    expect(created.filePath).toMatch(/\.ark$/)
    expect(updated).toMatchObject({ id: created.id, documentRevision: 2 })
    expect(updated?.html).toContain('Updated')

    workspaces!.close()
    workspaces = createWorkspaceStore(root!)
    await expect(workspaces.get(created.id)).resolves.toMatchObject({
      id: created.id,
      documentRevision: 2,
      html: expect.stringContaining('Updated'),
    })
  })

  it('persists multiple chat threads and their messages inside the workspace', async () => {
    const { deckStore, chatStore } = await stores()
    const deck = await deckStore.createDeck(sampleHtml)
    const first = await chatStore.createThread(deck.id, 'Design')
    const second = await chatStore.createThread(deck.id, 'Numbers')
    await chatStore.updateThread(deck.id, first.id, { archived: true })
    await chatStore.appendMessage(deck.id, { role: 'user', content: 'Check the totals' })

    expect(await chatStore.listThreads(deck.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, status: 'archived' }),
        expect.objectContaining({ id: second.id, status: 'active' }),
      ]),
    )
    await expect(chatStore.listMessages(deck.id)).resolves.toMatchObject({
      thread: { id: second.id },
      messages: [expect.objectContaining({ content: 'Check the totals', documentRevision: 1 })],
    })
  })

  it('stores asset bytes in SQLite and protects referenced assets', async () => {
    const { deckStore, assetStore } = await stores()
    const deck = await deckStore.createDeck(sampleHtml)
    const asset = await assetStore.createAsset({
      deckId: deck.id,
      filename: 'logo.png',
      mediaType: 'image/png',
      category: 'image',
      source: 'upload',
      bytes: Buffer.from('image bytes'),
    })

    await expect(assetStore.readBytes(deck.id, asset.id)).resolves.toEqual(
      Buffer.from('image bytes'),
    )
    await assetStore.addReference(deck.id, asset.id, 'document', '1', 'embedded')
    await expect(assetStore.deleteAsset(deck.id, asset.id)).resolves.toBeNull()
  })

  it('garbage-collects deleted thread attachments unless the document still uses them', async () => {
    const { deckStore, chatStore, assetStore } = await stores()
    const deck = await deckStore.createDeck(sampleHtml)
    const thread = await chatStore.createThread(deck.id, 'Sources')
    const message = await chatStore.appendMessage(deck.id, { role: 'user', content: 'Sources' })
    const attachmentOnly = await assetStore.createAsset({
      deckId: deck.id,
      chatMessageId: message.id,
      filename: 'notes.txt',
      mediaType: 'text/plain',
      category: 'text',
      source: 'upload',
      bytes: Buffer.from('notes'),
    })
    const shared = await assetStore.createAsset({
      deckId: deck.id,
      chatMessageId: message.id,
      filename: 'chart.png',
      mediaType: 'image/png',
      category: 'image',
      source: 'upload',
      bytes: Buffer.from('chart'),
    })
    await assetStore.addReference(deck.id, shared.id, 'document', '1', 'embedded')

    await expect(chatStore.deleteThread(deck.id, thread.id)).resolves.toBe(true)
    await expect(assetStore.getAsset(deck.id, attachmentOnly.id)).resolves.toBeNull()
    await expect(assetStore.getAsset(deck.id, shared.id)).resolves.toMatchObject({ id: shared.id })
  })

  it('extracts embedded data URLs into canonical ark-asset references on save', async () => {
    const { deckStore, assetStore } = await stores()
    const deck = await deckStore.createDeck(
      sampleHtml.replace('</body>', '<img src="data:image/png;base64,aGVsbG8=" /></body>'),
    )

    expect(deck.html).toMatch(/src="ark-asset:[0-9a-f-]{36}"/)
    expect(await assetStore.listAssetsByDeck(deck.id)).toEqual([
      expect.objectContaining({ mediaType: 'image/png', byteSize: 5 }),
    ])
  })

  it('keeps generation jobs process-local', async () => {
    const jobs = createGenerationJobStore()
    const created = await jobs.createJob({
      deckId: null,
      baseDocumentRevision: null,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: {
        messages: [{ role: 'user', content: 'Make slides' }],
        currentHtml: '',
        baseDocumentRevision: null,
        editingExistingDeck: false,
      },
    })

    expect((await jobs.claimQueuedJob(created.id, '2026-08-04T00:00:00.000Z'))?.status).toBe(
      'running',
    )
    await expect(createGenerationJobStore().getJob(created.id)).resolves.toBeNull()
  })
})
