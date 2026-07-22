import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createGenerationJobStore } from './generation-job-store.ts'

describe('file generation job store', () => {
  let dataDir = ''

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
      dataDir = ''
    }
  })

  it('creates, reads, and updates generation jobs', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-generation-jobs-'))
    const store = createGenerationJobStore(dataDir)

    const created = await store.createJob({
      deckId: null,
      baseVersionId: null,
      model: 'openai:gpt-5.6-luna',
      provider: 'openai',
      request: {
        messages: [{ role: 'user', content: 'Make a deck' }],
        currentHtml: '',
        editingExistingDeck: false,
        reasoningEffort: 'high',
      },
    })

    expect(created.status).toBe('queued')
    expect(created.progress.steps).toEqual([])
    expect(created.request.reasoningEffort).toBe('high')

    const reloaded = await store.getJob(created.id)
    expect(reloaded?.request.reasoningEffort).toBe('high')

    const updated = await store.updateJob(created.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
      progress: {
        steps: [{ type: 'text', summary: 'Working…' }],
        stepCount: 1,
      },
    })

    expect(updated?.status).toBe('running')
    expect(updated?.progress.steps).toHaveLength(1)
    expect(updated?.request.reasoningEffort).toBe('high')

    const claimed = await store.claimQueuedJob(created.id, new Date().toISOString())
    expect(claimed).toBeNull()

    const canceled = await store.updateJobIfStatus(created.id, 'running', {
      status: 'canceled',
      completedAt: new Date().toISOString(),
    })
    expect(canceled?.status).toBe('canceled')
    expect(canceled?.request.reasoningEffort).toBe('high')

    const loaded = await store.getJob(created.id)
    expect(loaded?.status).toBe('canceled')
    expect(loaded?.request.reasoningEffort).toBe('high')
  })
})
