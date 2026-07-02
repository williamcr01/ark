import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchGenerationJob,
  isActiveGenerationJobStatus,
  startGenerationJob,
} from './generation-job-api'

describe('generation-job-api', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts and reads generation jobs', async () => {
    const job = {
      id: '00000000-0000-4000-8000-000000000010',
      deckId: null,
      baseVersionId: null,
      status: 'queued' as const,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: {
        messages: [{ role: 'user' as const, content: 'Hello' }],
        currentHtml: '',
      },
      progress: { steps: [], stepCount: 0 },
      result: null,
      error: null,
      retryOfJobId: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      startedAt: null,
      completedAt: null,
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ job }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ job: { ...job, status: 'running' } }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const started = await startGenerationJob({
      messages: [{ role: 'user', content: 'Hello' }],
      currentHtml: '',
    })

    expect(started.status).toBe('queued')
    expect(isActiveGenerationJobStatus('running')).toBe(true)

    const running = await fetchGenerationJob(job.id)
    expect(running.status).toBe('running')
  })
})
