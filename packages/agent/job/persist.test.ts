import { describe, expect, it } from 'vitest'

import { persistJobResult } from './persist.ts'
import {
  createMemoryChatStore,
  createMemoryDeckStore,
  createTestContext,
  createTestDeps,
  SAMPLE_HTML,
  storedDeck,
  successAgentResult,
} from './test-support.ts'
import { createGenerationJobStore } from '@ark/storage/stores/generation-job-store.ts'

const observability = { requestId: 'req-1', durationMs: 12, providerMetrics: null }

describe('persistJobResult', () => {
  it('succeeds without creating a deck when the agent only asked a question', async () => {
    const jobStore = createGenerationJobStore()
    const deckStore = createMemoryDeckStore()
    const queued = await jobStore.createJob({
      deckId: null,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: { messages: [{ role: 'user', content: 'Make slides' }], currentHtml: '' },
    })
    const running = await jobStore.claimQueuedJob(queued.id, queued.createdAt)
    const deps = createTestDeps({ jobStore, deckStore, chatStore: null })
    const ctx = createTestContext(deps, running!)

    await persistJobResult(
      ctx,
      running!,
      {
        ...successAgentResult('', false),
        awaitingUserResponse: true,
        assistantText: 'Who is the audience?',
      },
      observability,
    )

    expect(await jobStore.getJob(queued.id)).toMatchObject({
      status: 'succeeded',
      deckId: null,
      result: null,
    })
    expect(await deckStore.listDecks()).toEqual([])
  })

  it('fails when the target deck is gone', async () => {
    const jobStore = createGenerationJobStore()
    const deckStore = createMemoryDeckStore()
    const queued = await jobStore.createJob({
      deckId: storedDeck().id,
      baseDocumentRevision: 1,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: {
        messages: [{ role: 'user', content: 'Update it' }],
        currentHtml: SAMPLE_HTML,
        editingExistingDeck: true,
      },
    })
    const running = await jobStore.claimQueuedJob(queued.id, queued.createdAt)
    const deps = createTestDeps({ jobStore, deckStore })
    const ctx = createTestContext(deps, running!)

    await persistJobResult(ctx, running!, successAgentResult(), observability)

    expect(await jobStore.getJob(queued.id)).toMatchObject({
      status: 'failed',
      error: { code: 'deck_not_found' },
    })
  })

  it('fails on a stale document revision without overwriting', async () => {
    const deck = storedDeck({ documentRevision: 2, html: SAMPLE_HTML.replace('Hello', 'Manual') })
    const jobStore = createGenerationJobStore()
    const deckStore = createMemoryDeckStore([deck])
    const queued = await jobStore.createJob({
      deckId: deck.id,
      baseDocumentRevision: 1,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: {
        messages: [{ role: 'user', content: 'Update it' }],
        currentHtml: SAMPLE_HTML,
        editingExistingDeck: true,
      },
    })
    const running = await jobStore.claimQueuedJob(queued.id, queued.createdAt)
    const ctx = createTestContext(createTestDeps({ jobStore, deckStore }), running!)

    await persistJobResult(ctx, running!, successAgentResult(), observability)

    expect(await jobStore.getJob(queued.id)).toMatchObject({
      status: 'failed',
      error: { code: 'document_conflict' },
    })
    expect((await deckStore.getDeck(deck.id))?.html).toContain('Manual')
  })

  it('writes chat before marking an unchanged existing deck succeeded', async () => {
    const deck = storedDeck()
    const jobStore = createGenerationJobStore()
    const deckStore = createMemoryDeckStore([deck])
    const chatStore = createMemoryChatStore()
    const queued = await jobStore.createJob({
      deckId: deck.id,
      baseDocumentRevision: 1,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: {
        messages: [{ role: 'user', content: 'Update it' }],
        currentHtml: SAMPLE_HTML,
        editingExistingDeck: true,
      },
    })
    const running = await jobStore.claimQueuedJob(queued.id, queued.createdAt)
    const ctx = createTestContext(createTestDeps({ jobStore, deckStore, chatStore }), running!)
    const order: string[] = []
    const originalAppend = chatStore.appendMessage.bind(chatStore)
    chatStore.appendMessage = async (deckId, input) => {
      order.push('chat')
      return originalAppend(deckId, input)
    }
    const originalUpdate = jobStore.updateJob.bind(jobStore)
    jobStore.updateJob = async (id, patch) => {
      if (patch.status === 'succeeded') {
        order.push('succeeded')
      }
      return originalUpdate(id, patch)
    }

    await persistJobResult(ctx, running!, successAgentResult(SAMPLE_HTML, false), observability)

    expect(order[0]).toBe('chat')
    expect(order).toContain('succeeded')
    expect(await jobStore.getJob(queued.id)).toMatchObject({ status: 'succeeded' })
    expect(chatStore.messages.at(-1)?.role).toBe('assistant')
  })

  it('creates a deck for a successful unscoped job and notifies listeners', async () => {
    const persisted: Array<[string, number]> = []
    const jobStore = createGenerationJobStore()
    const deckStore = createMemoryDeckStore()
    const queued = await jobStore.createJob({
      deckId: null,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: { messages: [{ role: 'user', content: 'Make slides' }], currentHtml: '' },
    })
    const running = await jobStore.claimQueuedJob(queued.id, queued.createdAt)
    const deps = createTestDeps({
      jobStore,
      deckStore,
      onDocumentPersisted: (deckId, revision) => persisted.push([deckId, revision]),
    })
    const ctx = createTestContext(deps, running!)

    await persistJobResult(ctx, running!, successAgentResult(), observability)

    const finished = await jobStore.getJob(queued.id)
    expect(finished).toMatchObject({ status: 'succeeded', result: { documentRevision: 1 } })
    expect(await deckStore.listDecks()).toEqual([
      expect.objectContaining({ id: finished?.deckId, documentRevision: 1 }),
    ])
    expect(persisted).toEqual([[finished?.deckId, 1]])
  })
})
