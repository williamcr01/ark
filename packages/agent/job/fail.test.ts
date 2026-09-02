import { describe, expect, it } from 'vitest'

import { failFromAgentResult, handleProcessJobError } from './fail.ts'
import {
  createTestContext,
  createTestDeps,
  failedAgentResult,
  jobSnapshot,
} from './test-support.ts'
import { createGenerationJobStore } from '@ark/storage/stores/generation-job-store.ts'

describe('failFromAgentResult', () => {
  it('marks the job failed with the provider error and logs a warning', async () => {
    const warnings: string[] = []
    const jobStore = createGenerationJobStore()
    const queued = await jobStore.createJob({
      deckId: null,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: { messages: [{ role: 'user', content: 'Make slides' }], currentHtml: '' },
    })
    const running = await jobStore.claimQueuedJob(queued.id, queued.createdAt)
    const ctx = createTestContext(createTestDeps({ jobStore }), running!)
    ctx.logger.warn = (event) => {
      warnings.push(event)
    }

    await failFromAgentResult(ctx, failedAgentResult('The model refused.'), {
      requestId: 'req-1',
      durationMs: 9,
      providerMetrics: failedAgentResult().providerMetrics ?? null,
    })

    expect(await jobStore.getJob(queued.id)).toMatchObject({
      status: 'failed',
      error: {
        message: 'The model refused.',
        code: 'provider_error',
        errorCategory: 'provider_error',
      },
    })
    expect(warnings).toEqual(['generation.job.failed'])
  })
})

describe('handleProcessJobError', () => {
  it('cancels when the job is already canceling', async () => {
    const jobStore = createGenerationJobStore()
    const queued = await jobStore.createJob({
      deckId: null,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: { messages: [{ role: 'user', content: 'Make slides' }], currentHtml: '' },
    })
    const running = await jobStore.claimQueuedJob(queued.id, queued.createdAt)
    await jobStore.updateJob(queued.id, { status: 'canceling' })
    const ctx = createTestContext(
      createTestDeps({ jobStore }),
      jobSnapshot({ ...running!, status: 'canceling' }),
    )

    await handleProcessJobError(ctx, new Error('boom'))

    expect(await jobStore.getJob(queued.id)).toMatchObject({
      status: 'canceled',
      observability: { providerMetrics: { errorCategory: 'aborted' } },
    })
  })

  it('fails with the thrown message otherwise', async () => {
    const jobStore = createGenerationJobStore()
    const queued = await jobStore.createJob({
      deckId: null,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: { messages: [{ role: 'user', content: 'Make slides' }], currentHtml: '' },
    })
    const running = await jobStore.claimQueuedJob(queued.id, queued.createdAt)
    const ctx = createTestContext(createTestDeps({ jobStore }), running!)

    await handleProcessJobError(ctx, new Error('Finalized deck HTML is invalid.'))

    expect(await jobStore.getJob(queued.id)).toMatchObject({
      status: 'failed',
      error: { message: 'Finalized deck HTML is invalid.' },
    })
  })
})
