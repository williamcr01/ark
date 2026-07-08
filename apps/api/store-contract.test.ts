import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { AssetStore } from './asset-record.ts'
import { createAssetStore } from './asset-store.ts'
import type { ChatStore } from './chat-record.ts'
import { createChatStore } from './chat-store.ts'
import type { DeckStore } from './deck-record.ts'
import { createDeckStore } from './deck-store.ts'
import { createPostgresAssetStore } from './db/repositories/assets.ts'
import { createPostgresChatStore } from './db/repositories/chat.ts'
import { createPostgresDeckStore } from './db/repositories/decks.ts'
import { createPostgresGenerationJobStore } from './db/repositories/generation-jobs.ts'
import { createMemoryPostgresPool } from './db/test-utils.ts'
import type { GenerationJobStore } from './generation-job-record.ts'
import { createGenerationJobStore } from './generation-job-store.ts'

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

type TestStores = {
  deckStore: DeckStore
  chatStore: ChatStore
  assetStore: AssetStore
  generationJobStore: GenerationJobStore
  cleanup: () => Promise<void>
}

async function makeJsonStores(): Promise<TestStores> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ark-contract-'))
  const deckDir = path.join(root, 'decks')
  const chatDir = path.join(root, 'chat')
  const jobDir = path.join(root, 'jobs')
  const assetDir = path.join(root, 'assets')

  return {
    deckStore: createDeckStore(deckDir),
    chatStore: createChatStore(chatDir),
    assetStore: createAssetStore(assetDir),
    generationJobStore: createGenerationJobStore(jobDir),
    cleanup: async () => rm(root, { recursive: true, force: true }),
  }
}

function makePgMemStores(): TestStores {
  const pool = createMemoryPostgresPool()

  return {
    deckStore: createPostgresDeckStore({ pool }),
    chatStore: createPostgresChatStore({ pool }),
    assetStore: createPostgresAssetStore({ pool }),
    generationJobStore: createPostgresGenerationJobStore({ pool }),
    cleanup: async () => pool.end?.(),
  }
}

describe.each([
  ['json', makeJsonStores],
  ['postgres', makePgMemStores],
])('%s backend contract', (_name, makeStores) => {
  let stores: TestStores | null = null

  afterEach(async () => {
    if (stores) {
      await stores.cleanup()
      stores = null
    }
  })

  it('creates decks, versions them, and rolls back', async () => {
    stores = await makeStores()
    const { deckStore } = stores

    const created = await deckStore.createDeck(sampleHtml, {
      source: 'upload',
      summary: 'Initial upload',
    })
    const updated = await deckStore.updateDeck(created.id, sampleHtml.replace('Hello', 'Updated'), {
      source: 'agent',
      summary: 'AI edit',
      modelName: 'gpt-4.1',
    })

    expect(updated?.versionNumber).toBe(2)

    const versions = await deckStore.listVersions(created.id)
    expect(versions).toHaveLength(2)
    expect(versions?.[0]).toMatchObject({
      versionNumber: 2,
      source: 'agent',
      isActive: true,
    })

    const rolledBack = await deckStore.rollbackToVersion(created.id, versions![1].id)
    expect(rolledBack?.html).toBe(sampleHtml)
    expect(rolledBack?.versionNumber).toBe(3)
  })

  it('appends and clears chat history for a deck', async () => {
    stores = await makeStores()
    const { deckStore, chatStore } = stores

    const deck = await deckStore.createDeck(sampleHtml)
    await chatStore.getOrCreateActiveThread(deck.id, deck.activeVersionId ?? null)

    await chatStore.appendMessage(deck.id, {
      role: 'user',
      content: 'Make this darker',
      deckVersionId: deck.activeVersionId ?? null,
    })
    await chatStore.appendMessage(deck.id, {
      role: 'assistant',
      content: 'Applied a dark theme.',
      parts: [{ type: 'tool-call', toolName: 'patch_deck', summary: 'Updated styles' }],
      generationJobId: '00000000-0000-4000-8000-000000000401',
      generationStatus: 'succeeded',
      model: 'openai:gpt-4.1-mini',
    })

    const listed = await chatStore.listMessages(deck.id)
    expect(listed.messages.map((message) => message.content)).toEqual([
      'Make this darker',
      'Applied a dark theme.',
    ])

    expect(await chatStore.clearThread(deck.id)).toBe(true)
    expect(await chatStore.listMessages(deck.id)).toEqual({
      thread: null,
      messages: [],
      hasMore: false,
    })
  })

  it('creates, lists, and soft-deletes assets scoped to a deck', async () => {
    stores = await makeStores()
    const { deckStore, assetStore } = stores

    const deck = await deckStore.createDeck(sampleHtml)
    const created = await assetStore.createAsset({
      deckId: deck.id,
      chatMessageId: null,
      filename: 'logo.png',
      mediaType: 'image/png',
      category: 'image',
      byteSize: 128,
      checksum: 'abc123',
      source: 'upload',
      storageKind: 'local',
      storageKey: '00000000-0000-4000-8000-0000000005a1',
    })

    expect(created.deckId).toBe(deck.id)
    expect(await assetStore.getAsset(created.id)).toMatchObject({
      filename: 'logo.png',
      byteSize: 128,
      category: 'image',
    })

    const listed = await assetStore.listAssetsByDeck(deck.id)
    expect(listed).toHaveLength(1)

    const deleted = await assetStore.deleteAsset(created.id)
    expect(deleted?.storageKey).toBe('00000000-0000-4000-8000-0000000005a1')
    expect(await assetStore.getAsset(created.id)).toBeNull()
    expect(await assetStore.listAssetsByDeck(deck.id)).toHaveLength(0)
  })

  it('cleans up every asset when a deck is deleted', async () => {
    stores = await makeStores()
    const { deckStore, assetStore } = stores

    const deck = await deckStore.createDeck(sampleHtml)
    await assetStore.createAsset({
      deckId: deck.id,
      chatMessageId: null,
      filename: 'a.png',
      mediaType: 'image/png',
      category: 'image',
      byteSize: 1,
      checksum: 'a',
      source: 'upload',
      storageKind: 'local',
      storageKey: '00000000-0000-4000-8000-0000000005b1',
    })
    await assetStore.createAsset({
      deckId: deck.id,
      chatMessageId: null,
      filename: 'b.csv',
      mediaType: 'text/csv',
      category: 'text',
      byteSize: 2,
      checksum: 'b',
      source: 'upload',
      storageKind: 'local',
      storageKey: '00000000-0000-4000-8000-0000000005b2',
    })

    const removed = await assetStore.deleteAssetsByDeck(deck.id)
    expect(removed).toHaveLength(2)
    expect(await assetStore.listAssetsByDeck(deck.id)).toHaveLength(0)
  })

  it('persists provenance, diff, and model fields identically across backends', async () => {
    stores = await makeStores()
    const { deckStore } = stores

    const created = await deckStore.createDeck(sampleHtml, {
      source: 'upload',
      summary: 'Initial upload',
      modelProvider: 'openai',
      modelName: 'gpt-4.1-mini',
    })

    const provenance = {
      operations: ['update_slide_title' as const],
      slideIndexes: [0],
      runtimeManifestHash: 'abc123def456',
    }
    const diff = {
      kind: 'structural' as const,
      slideCountBefore: 1,
      slideCountAfter: 1,
      changedSlides: [{ index: 0, titleChanged: true, title: 'Updated' }],
    }

    await deckStore.updateDeck(created.id, sampleHtml.replace('Hello', 'Updated'), {
      source: 'manual',
      summary: 'Manual title edit',
      modelProvider: 'openai',
      modelName: 'gpt-4.1-mini',
      provenance,
      diff,
    })

    const versions = await deckStore.listVersions(created.id)
    const active = versions?.find((version) => version.isActive)

    expect(active).toMatchObject({
      source: 'manual',
      summary: 'Manual title edit',
      modelProvider: 'openai',
      modelName: 'gpt-4.1-mini',
      provenance,
      diff,
    })

    const firstVersion = versions?.find((version) => version.versionNumber === 1)
    expect(firstVersion?.provenance).toBeNull()
    expect(firstVersion?.diff).toBeNull()

    const rolledBack = await deckStore.rollbackToVersion(created.id, firstVersion!.id, {
      provenance: {
        restoredVersionId: firstVersion!.id,
        restoredVersionNumber: 1,
        runtimeManifestHash: 'rollback-hash',
      },
      diff: {
        kind: 'structural',
        slideCountBefore: 1,
        slideCountAfter: 1,
      },
    })

    expect(rolledBack?.versionNumber).toBe(3)

    const rollbackVersion = (await deckStore.listVersions(created.id))?.[0]
    expect(rollbackVersion?.provenance).toMatchObject({
      restoredVersionId: firstVersion!.id,
      restoredVersionNumber: 1,
    })
    expect(rollbackVersion?.diff?.kind).toBe('structural')
  })

  it('runs generation job lifecycle with cancel and retry semantics', async () => {
    stores = await makeStores()
    const { deckStore, generationJobStore: jobStore } = stores

    const deck = await deckStore.createDeck(sampleHtml)
    const created = await jobStore.createJob({
      deckId: deck.id,
      baseVersionId: deck.activeVersionId,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: {
        messages: [{ role: 'user', content: 'Make slides' }],
        currentHtml: deck.html,
        baseVersionId: deck.activeVersionId,
        editingExistingDeck: true,
      },
    })

    const running = await jobStore.claimQueuedJob(created.id, '2026-07-01T12:00:00.000Z')
    expect(running?.status).toBe('running')

    const canceled = await jobStore.updateJobIfStatus(created.id, 'running', {
      status: 'canceled',
      completedAt: '2026-07-01T12:00:01.000Z',
    })
    expect(canceled?.status).toBe('canceled')

    const failed = await jobStore.createJob({
      deckId: deck.id,
      baseVersionId: deck.activeVersionId,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: {
        messages: [{ role: 'user', content: 'Retry me' }],
        currentHtml: deck.html,
        editingExistingDeck: true,
      },
    })

    await jobStore.updateJob(failed.id, {
      status: 'failed',
      error: { message: 'Provider unavailable', code: 'provider_error' },
      completedAt: '2026-07-01T12:00:02.000Z',
    })

    const retried = await jobStore.createJob({
      deckId: failed.deckId,
      baseVersionId: failed.baseVersionId,
      model: failed.model,
      provider: failed.provider,
      request: failed.request,
      retryOfJobId: failed.id,
    })

    expect(retried.retryOfJobId).toBe(failed.id)
    expect(retried.status).toBe('queued')

    const listed = await jobStore.listJobsForDeck(deck.id)
    expect(listed.length).toBeGreaterThanOrEqual(3)
    expect(listed.some((job) => job.id === retried.id)).toBe(true)
  })
})
