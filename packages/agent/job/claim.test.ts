import { describe, expect, it } from 'vitest'

import { createGenerationJobStore } from '@ark/storage/stores/generation-job-store.ts'
import { claimJob } from './claim.ts'
import { createJobControllerRegistry } from './controller-registry.ts'
import { createTestDeps, silentLogger } from './test-support.ts'

describe('claimJob', () => {
  it('returns null when the job cannot be claimed', async () => {
    const deps = createTestDeps({ jobStore: createGenerationJobStore() })
    await expect(claimJob(deps, 'missing-id')).resolves.toBeNull()
  })

  it('leases a queued job, registers an abort controller, and logs start', async () => {
    const events: string[] = []
    const controllers = createJobControllerRegistry()
    const jobStore = createGenerationJobStore()
    const queued = await jobStore.createJob({
      deckId: null,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: { messages: [{ role: 'user', content: 'Make slides' }], currentHtml: '' },
    })
    const deps = createTestDeps({
      jobStore,
      controllers,
      createLogger: () => {
        const logger = silentLogger()
        return {
          ...logger,
          info(event) {
            events.push(event)
          },
        }
      },
    })

    const ctx = await claimJob(deps, queued.id, 'req-9')

    expect(ctx).not.toBeNull()
    expect(ctx?.job.status).toBe('running')
    expect(ctx?.job.id).toBe(queued.id)
    expect(ctx?.requestId).toBe('req-9')
    expect(ctx?.signal.aborted).toBe(false)
    expect(controllers.get(queued.id)).toBe(ctx?.abortController)
    expect(events).toEqual(['generation.job.started'])
    expect(await jobStore.getJob(queued.id)).toMatchObject({ status: 'running' })
  })
})
