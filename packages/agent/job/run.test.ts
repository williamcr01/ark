import { describe, expect, it } from 'vitest'

import { runJobAgent } from './run.ts'
import {
  createTestContext,
  createTestDeps,
  jobSnapshot,
  successAgentResult,
} from './test-support.ts'
import { createGenerationJobStore } from '@ark/storage/stores/generation-job-store.ts'

describe('runJobAgent', () => {
  it('aborts when step progress sees a canceling job', async () => {
    const jobStore = createGenerationJobStore()
    const queued = await jobStore.createJob({
      deckId: null,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: { messages: [{ role: 'user', content: 'Make slides' }], currentHtml: '' },
    })
    const running = await jobStore.claimQueuedJob(queued.id, queued.createdAt)
    await jobStore.updateJob(queued.id, { status: 'canceling' })
    const abortController = new AbortController()
    const ctx = createTestContext(
      createTestDeps({
        jobStore,
        runAgent: async (options) => {
          await options.onStepProgress?.([{ type: 'text', text: 'working', stepIndex: 0 } as never])
          return successAgentResult()
        },
      }),
      jobSnapshot({ ...running!, status: 'canceling' }),
    )
    ctx.abortController = abortController
    Object.assign(ctx, { signal: abortController.signal })

    await runJobAgent(ctx, {} as never, 'openai', {
      modelMessages: running!.request.messages,
      attachmentInspector: undefined,
    })

    expect(abortController.signal.aborted).toBe(true)
  })

  it('records observability from the agent result', async () => {
    const result = successAgentResult()
    const ctx = createTestContext(
      createTestDeps({
        runAgent: async () => result,
      }),
    )

    const ran = await runJobAgent(ctx, {} as never, 'openai', {
      modelMessages: ctx.job.request.messages,
      attachmentInspector: undefined,
    })

    expect(ran.agentResult).toBe(result)
    expect(ran.observability.requestId).toBe('req-1')
    expect(ran.observability.providerMetrics).toEqual(result.providerMetrics)
  })
})
