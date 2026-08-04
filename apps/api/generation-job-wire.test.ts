import { describe, expect, it } from 'vitest'

import { toGenerationJobApi } from './generation-job-wire.ts'

const deckId = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'
const jobId = 'a0000000-0000-4000-8000-000000000001'

describe('toGenerationJobApi', () => {
  it('maps storage jobs to the wire shape without request or html', () => {
    const api = toGenerationJobApi({
      id: jobId,
      deckId,
      baseDocumentRevision: null,
      chatThreadId: 'thread-1',
      assetIds: ['00000000-0000-4000-8000-000000000099'],
      status: 'succeeded',
      model: 'openai:gpt-4o-mini',
      provider: 'openai',
      request: {
        messages: [{ role: 'user', content: 'Hello' }],
        currentHtml: '<html></html>',
        editingExistingDeck: true,
      },
      progress: { steps: [], stepCount: 0, assistantText: 'Done.' },
      result: {
        deckId,
        documentRevision: 1,
        html: '<html><body>slides</body></html>',
        validation: {
          valid: true,
          slideCount: 1,
          scripts: [],
          forms: 0,
          iframes: 0,
          externalUrls: [],
          malformedSlides: [],
          runtimeMarkers: {},
          issues: [],
        },
        assistantText: 'Done.',
      },
      error: null,
      observability: { durationMs: 1200 },
      retryOfJobId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z',
      startedAt: '2026-01-01T00:00:10.000Z',
      completedAt: '2026-01-01T00:01:00.000Z',
    })

    expect(api).toMatchObject({
      id: jobId,
      deckId,
      status: 'succeeded',
      progress: { assistantText: 'Done.' },
      result: {
        deckId,
        assistantText: 'Done.',
      },
    })

    expect(api).not.toHaveProperty('assetIds')
    expect(api).not.toHaveProperty('request')
    expect(api.result).not.toHaveProperty('html')
  })
})
