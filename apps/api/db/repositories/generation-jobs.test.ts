import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { ConnectablePool } from '../client.ts'
import {
  createMigratedMemoryPostgresPool,
  stubStaticRuntimeManifest,
  truncateMemoryPostgresAppTables,
} from '../test-utils.ts'
import { createPostgresChatStore } from './chat.ts'
import { createPostgresDeckStore } from './decks.ts'
import { createPostgresGenerationJobStore } from './generation-jobs.ts'

const fastOptions = { runtimeManifest: stubStaticRuntimeManifest }

const sampleRequest = {
  messages: [{ role: 'user' as const, content: 'Make a deck about quarterly results' }],
  currentHtml: '',
  editingExistingDeck: false,
}

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

describe('createPostgresGenerationJobStore', () => {
  let pool: ConnectablePool
  let deckStore: ReturnType<typeof createPostgresDeckStore>
  let chatStore: ReturnType<typeof createPostgresChatStore>
  let jobStore: ReturnType<typeof createPostgresGenerationJobStore>
  let currentTime = new Date('2026-07-01T11:00:00.000Z')

  beforeAll(async () => {
    pool = await createMigratedMemoryPostgresPool()
    deckStore = createPostgresDeckStore({ pool, migrate: false })
    chatStore = createPostgresChatStore({ pool, migrate: false })
    jobStore = createPostgresGenerationJobStore({
      pool,
      migrate: false,
      now: () => currentTime,
    })
  })

  beforeEach(async () => {
    currentTime = new Date('2026-07-01T11:00:00.000Z')
    await truncateMemoryPostgresAppTables(pool)
  })

  afterAll(async () => {
    await pool.end?.()
  })

  it('creates and reads jobs with all fields intact', async () => {
    const deck = await deckStore.createDeck(sampleHtml, fastOptions)
    const thread = await chatStore.getOrCreateActiveThread(deck.id, deck.activeVersionId ?? null)
    const created = await jobStore.createJob({
      deckId: deck.id,
      baseVersionId: deck.activeVersionId,
      chatThreadId: thread.id,
      model: 'openai:gpt-5.6-luna',
      provider: 'openai',
      request: {
        ...sampleRequest,
        currentHtml: deck.html,
        baseVersionId: deck.activeVersionId,
        editingExistingDeck: true,
        reasoningEffort: 'high',
      },
    })

    expect(created.status).toBe('queued')
    expect(created.deckId).toBe(deck.id)
    expect(created.baseVersionId).toBe(deck.activeVersionId)
    expect(created.chatThreadId).toBe(thread.id)
    expect(created.model).toBe('openai:gpt-5.6-luna')
    expect(created.provider).toBe('openai')
    expect(created.request.messages).toEqual(sampleRequest.messages)
    expect(created.request.currentHtml).toBe(deck.html)
    expect(created.request.reasoningEffort).toBe('high')
    expect(created.progress.steps).toEqual([])
    expect(created.startedAt).toBeNull()
    expect(created.completedAt).toBeNull()

    const loaded = await jobStore.getJob(created.id)
    expect(loaded).toEqual(created)

    const updated = await jobStore.updateJob(created.id, {
      status: 'running',
      startedAt: '2026-07-01T12:00:00.000Z',
    })
    expect(updated?.request.reasoningEffort).toBe('high')
  })

  it('runs the full job lifecycle through success and failure', async () => {
    const startedAt = '2026-07-01T12:00:00.000Z'
    const completedAt = '2026-07-01T12:00:05.000Z'

    const deck = await deckStore.createDeck(sampleHtml, fastOptions)
    const created = await jobStore.createJob({
      deckId: deck.id,
      baseVersionId: deck.activeVersionId,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: {
        ...sampleRequest,
        currentHtml: deck.html,
        editingExistingDeck: true,
      },
    })

    const running = await jobStore.claimQueuedJob(created.id, startedAt)
    expect(running?.status).toBe('running')
    expect(running?.startedAt).toBe(startedAt)

    const succeeded = await jobStore.updateJobIfStatus(created.id, 'running', {
      status: 'succeeded',
      completedAt,
      progress: {
        steps: [{ type: 'text', summary: 'Done' }],
        stepCount: 1,
        assistantText: 'Created your deck.',
      },
      result: {
        deckId: deck.id,
        versionId: deck.activeVersionId!,
        html: deck.html,
        validation: { ok: true },
        assistantText: 'Created your deck.',
      },
    })

    expect(succeeded?.status).toBe('succeeded')
    expect(succeeded?.completedAt).toBe(completedAt)
    expect(succeeded?.result?.html).toBe(deck.html)

    const failedJob = await jobStore.createJob({
      deckId: null,
      baseVersionId: null,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: sampleRequest,
    })

    await jobStore.claimQueuedJob(failedJob.id, startedAt)
    const failed = await jobStore.updateJobIfStatus(failedJob.id, 'running', {
      status: 'failed',
      completedAt,
      error: {
        message: 'Provider unavailable',
        code: 'provider_error',
        errorCategory: 'provider',
      },
    })

    expect(failed?.status).toBe('failed')
    expect(failed?.error).toMatchObject({
      message: 'Provider unavailable',
      code: 'provider_error',
      errorCategory: 'provider',
    })
  })

  it('cancels queued jobs and rejects stale claims', async () => {
    const completedAt = '2026-07-01T12:00:01.000Z'

    const job = await jobStore.createJob({
      deckId: null,
      baseVersionId: null,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: sampleRequest,
    })

    const canceled = await jobStore.updateJobIfStatus(job.id, 'queued', {
      status: 'canceled',
      completedAt,
    })

    expect(canceled?.status).toBe('canceled')
    expect(canceled?.completedAt).toBe(completedAt)

    const claimed = await jobStore.claimQueuedJob(job.id, '2026-07-01T12:00:02.000Z')
    expect(claimed).toBeNull()

    const stored = await jobStore.getJob(job.id)
    expect(stored?.status).toBe('canceled')
    expect(stored?.startedAt).toBeNull()
  })

  it('cancels running jobs and leaves terminal jobs unchanged', async () => {
    const startedAt = '2026-07-01T12:00:00.000Z'
    const completedAt = '2026-07-01T12:00:03.000Z'

    const runningJob = await jobStore.createJob({
      deckId: null,
      baseVersionId: null,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: sampleRequest,
    })

    await jobStore.claimQueuedJob(runningJob.id, startedAt)
    const canceled = await jobStore.updateJob(runningJob.id, {
      status: 'canceled',
      completedAt,
    })

    expect(canceled?.status).toBe('canceled')
    expect(canceled?.startedAt).toBe(startedAt)

    const deck = await deckStore.createDeck(sampleHtml, fastOptions)
    const succeededJob = await jobStore.createJob({
      deckId: deck.id,
      baseVersionId: deck.activeVersionId,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: {
        ...sampleRequest,
        currentHtml: deck.html,
        editingExistingDeck: true,
      },
    })

    await jobStore.claimQueuedJob(succeededJob.id, startedAt)
    await jobStore.updateJobIfStatus(succeededJob.id, 'running', {
      status: 'succeeded',
      completedAt,
      progress: { steps: [], stepCount: 0 },
      result: {
        deckId: deck.id,
        versionId: deck.activeVersionId!,
        html: deck.html,
        validation: null,
        assistantText: 'Done',
      },
    })

    const noopCancel = await jobStore.updateJobIfStatus(succeededJob.id, 'running', {
      status: 'canceled',
      completedAt: '2026-07-01T12:00:04.000Z',
    })
    expect(noopCancel).toBeNull()
    expect((await jobStore.getJob(succeededJob.id))?.status).toBe('succeeded')
  })

  it('creates retry jobs with retry relationship metadata', async () => {
    const failed = await jobStore.createJob({
      deckId: null,
      baseVersionId: null,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: sampleRequest,
    })

    await jobStore.updateJob(failed.id, {
      status: 'failed',
      error: { message: 'Provider unavailable', code: 'provider_error' },
      completedAt: '2026-07-01T12:00:00.000Z',
    })

    const retried = await jobStore.createJob({
      deckId: failed.deckId,
      baseVersionId: failed.baseVersionId,
      model: failed.model,
      provider: failed.provider,
      request: failed.request,
      retryOfJobId: failed.id,
    })

    expect(retried.status).toBe('queued')
    expect(retried.retryOfJobId).toBe(failed.id)
    expect(retried.request.messages).toEqual(failed.request.messages)
  })

  it('lists jobs for a deck in reverse chronological order', async () => {
    const deck = await deckStore.createDeck(sampleHtml, fastOptions)
    const older = await jobStore.createJob({
      deckId: deck.id,
      baseVersionId: deck.activeVersionId,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: { ...sampleRequest, currentHtml: deck.html, editingExistingDeck: true },
    })

    currentTime = new Date('2026-07-01T12:00:00.000Z')

    const newer = await jobStore.createJob({
      deckId: deck.id,
      baseVersionId: deck.activeVersionId,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: { ...sampleRequest, currentHtml: deck.html, editingExistingDeck: true },
    })

    const listed = await jobStore.listJobsForDeck(deck.id)
    expect(listed.map((job) => job.id)).toEqual([newer.id, older.id])
  })

  it('rejects invalid job ids and stale status updates', async () => {
    expect(await jobStore.getJob('../escape')).toBeNull()
    expect(await jobStore.updateJob('missing-id', { status: 'running' })).toBeNull()
    expect(
      await jobStore.updateJobIfStatus('missing-id', 'queued', { status: 'running' }),
    ).toBeNull()

    const job = await jobStore.createJob({
      deckId: null,
      baseVersionId: null,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: sampleRequest,
    })

    await jobStore.claimQueuedJob(job.id, '2026-07-01T12:00:00.000Z')

    const staleQueuedUpdate = await jobStore.updateJobIfStatus(job.id, 'queued', {
      status: 'canceled',
      completedAt: '2026-07-01T12:00:01.000Z',
    })
    expect(staleQueuedUpdate).toBeNull()
    expect((await jobStore.getJob(job.id))?.status).toBe('running')
  })

  it('preserves assetIds through claim and update paths', async () => {
    const assetIds = ['00000000-0000-4000-8000-000000000099']
    const startedAt = '2026-07-01T12:00:00.000Z'

    const created = await jobStore.createJob({
      deckId: null,
      baseVersionId: null,
      assetIds,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: sampleRequest,
    })

    expect(created.assetIds).toEqual(assetIds)

    const running = await jobStore.claimQueuedJob(created.id, startedAt)
    expect(running?.assetIds).toEqual(assetIds)

    const updated = await jobStore.updateJob(created.id, {
      progress: {
        steps: [{ type: 'text', summary: 'Working' }],
        stepCount: 1,
      },
    })
    expect(updated?.assetIds).toEqual(assetIds)

    const stored = await jobStore.getJob(created.id)
    expect(stored?.assetIds).toEqual(assetIds)
  })
})
