import { describe, expect, it } from 'vitest'

import { buildRetryJob, buildStartJobInput } from './build-job.ts'
import { createMemoryDeckStore, createTestDeps, SAMPLE_HTML, storedDeck } from './test-support.ts'
import { createGenerationJobStore } from '@ark/storage/stores/generation-job-store.ts'

describe('buildStartJobInput', () => {
  it('rejects an empty message list', async () => {
    const deps = createTestDeps()
    await expect(
      buildStartJobInput(deps, {
        body: { messages: [], currentHtml: '' },
        defaultModel: 'openai:gpt-test',
      }),
    ).rejects.toMatchObject({
      message: 'At least one user message is required.',
      apiError: { code: 'provider_error' },
    })
  })

  it('rejects when the latest message is not from the user', async () => {
    const deps = createTestDeps()
    await expect(
      buildStartJobInput(deps, {
        body: {
          messages: [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hello' },
          ],
          currentHtml: '',
        },
        defaultModel: 'openai:gpt-test',
      }),
    ).rejects.toMatchObject({
      message: 'The latest chat message must be from the user.',
    })
  })

  it('rejects when no model is available', async () => {
    const deps = createTestDeps()
    await expect(
      buildStartJobInput(deps, {
        body: { messages: [{ role: 'user', content: 'Make slides' }], currentHtml: '' },
        defaultModel: null,
      }),
    ).rejects.toMatchObject({
      apiError: { code: 'missing_api_key' },
    })
  })

  it('rejects a second in-flight job for the same deck', async () => {
    const deck = storedDeck()
    const jobStore = createGenerationJobStore()
    await jobStore.createJob({
      deckId: deck.id,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: { messages: [{ role: 'user', content: 'first' }], currentHtml: SAMPLE_HTML },
    })
    const deps = createTestDeps({
      jobStore,
      deckStore: createMemoryDeckStore([deck]),
    })

    await expect(
      buildStartJobInput(deps, {
        body: {
          deckId: deck.id,
          currentHtml: SAMPLE_HTML,
          messages: [{ role: 'user', content: 'second' }],
        },
        defaultModel: 'openai:gpt-test',
      }),
    ).rejects.toMatchObject({
      message: 'A generation job is already in progress for this deck.',
    })
  })

  it('reads origin from the stored deck, not the request body', async () => {
    const deck = storedDeck({ origin: 'blank' })
    const deps = createTestDeps({ deckStore: createMemoryDeckStore([deck]) })
    const input = await buildStartJobInput(deps, {
      body: {
        deckId: deck.id,
        currentHtml: SAMPLE_HTML,
        messages: [{ role: 'user', content: 'Make slides' }],
      },
      defaultModel: 'openai:gpt-test',
    })

    expect(input.request.editingExistingDeck).toBe(false)
    expect(input.request.deckOrigin).toBe('blank')
  })
})

describe('buildRetryJob', () => {
  it('returns null for succeeded or in-flight jobs', async () => {
    const jobStore = createGenerationJobStore()
    const queued = await jobStore.createJob({
      deckId: null,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: { messages: [{ role: 'user', content: 'Make slides' }], currentHtml: '' },
    })
    const deps = createTestDeps({ jobStore })

    await expect(buildRetryJob(deps, queued.id)).resolves.toBeNull()

    const running = await jobStore.claimQueuedJob(queued.id, queued.createdAt)
    await expect(buildRetryJob(deps, running!.id)).resolves.toBeNull()
  })

  it('clones a failed new-deck job and appends a retry turn', async () => {
    const jobStore = createGenerationJobStore()
    const queued = await jobStore.createJob({
      deckId: null,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: { messages: [{ role: 'user', content: 'Make slides' }], currentHtml: '' },
    })
    await jobStore.claimQueuedJob(queued.id, queued.createdAt)
    await jobStore.updateJob(queued.id, {
      status: 'failed',
      error: { message: 'Provider failed.', code: 'provider_error' },
    })
    const deps = createTestDeps({ jobStore, chatStore: null })
    const built = await buildRetryJob(deps, queued.id)

    expect(built).not.toBeNull()
    expect(built?.input.retryOfJobId).toBe(queued.id)
    expect(built?.input.request.messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'Retry previous request',
    })
  })
})
