import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { createApp } from './app.ts'
import { createDeckStore } from './deck-store.ts'
import { createGenerationJobStore } from './generation-job-store.ts'
import { createGenerationJobRunner } from './generation-job-runner.ts'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Generated Deck</title>
</head>
<body>
  <section class="slide"><h1>Hello</h1></section>
</body>
</html>`

describe('generation job runner', () => {
  let deckDir = ''
  let jobDir = ''

  afterEach(async () => {
    for (const dir of [deckDir, jobDir]) {
      if (dir) {
        await rm(dir, { recursive: true, force: true })
      }
    }

    deckDir = ''
    jobDir = ''
  })

  async function createRunner() {
    deckDir = await mkdtemp(path.join(os.tmpdir(), 'ark-runner-decks-'))
    jobDir = await mkdtemp(path.join(os.tmpdir(), 'ark-runner-jobs-'))

    const deckStore = createDeckStore(deckDir)
    const jobStore = createGenerationJobStore(jobDir)

    const runner = createGenerationJobRunner({
      deckStore,
      jobStore,
      createModel: () => ({
        model: {} as never,
        provider: 'openai',
        modelId: 'gpt-4.1-mini',
      }),
      now: () => new Date('2026-07-01T12:00:00.000Z'),
    })

    return { deckStore, jobStore, runner }
  }

  it('marks canceled queued jobs without running the agent', async () => {
    const { runner, jobStore } = await createRunner()

    const job = await runner.startJob({
      defaultModel: 'openai:gpt-4.1-mini',
      body: {
        messages: [{ role: 'user', content: 'Make slides' }],
        currentHtml: '',
      },
    })

    const canceled = await runner.cancelJob(job.id)
    expect(canceled?.status).toBe('canceled')

    const stored = await jobStore.getJob(job.id)
    expect(stored?.status).toBe('canceled')
    expect(stored?.completedAt).toBeTruthy()
  })

  it('retries failed jobs with retry relationship metadata', async () => {
    const { runner, jobStore } = await createRunner()

    const failed = await jobStore.createJob({
      deckId: null,
      baseVersionId: null,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: {
        messages: [{ role: 'user', content: 'Retry me' }],
        currentHtml: '',
      },
    })

    await jobStore.updateJob(failed.id, {
      status: 'failed',
      error: { message: 'Provider unavailable', code: 'provider_error' },
      completedAt: new Date().toISOString(),
    })

    const retried = await runner.retryJob(failed.id)

    expect(retried?.retryOfJobId).toBe(failed.id)
    expect(retried?.status).toBe('queued')

    if (retried) {
      await runner.cancelJob(retried.id)
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  })
})

describe('generation job API routes', () => {
  let deckDir = ''
  let jobDir = ''
  let server: Server | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()))
      })
      server = null
    }

    for (const dir of [deckDir, jobDir]) {
      if (dir) {
        await rm(dir, { recursive: true, force: true })
      }
    }

    deckDir = ''
    jobDir = ''
  })

  async function startApi() {
    deckDir = await mkdtemp(path.join(os.tmpdir(), 'ark-job-api-decks-'))
    jobDir = await mkdtemp(path.join(os.tmpdir(), 'ark-job-api-jobs-'))

    const deckStore = createDeckStore(deckDir)
    const jobStore = createGenerationJobStore(jobDir)
    const generationJobRunner = createGenerationJobRunner({
      deckStore,
      jobStore,
      createModel: () => ({
        model: {} as never,
        provider: 'openai',
        modelId: 'gpt-4.1-mini',
      }),
    })

    const app = createApp({
      deckStore,
      generationJobStore: jobStore,
      generationJobRunner,
    })

    server = app.listen(0)
    await new Promise<void>((resolve) => server?.once('listening', resolve))

    const address = server.address() as AddressInfo
    return `http://127.0.0.1:${address.port}`
  }

  it('starts and reads a generation job quickly', async () => {
    const previousKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-test-generation-job-route'

    try {
      const baseUrl = await startApi()

      const response = await fetch(`${baseUrl}/api/generation-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Create a title slide' }],
          currentHtml: sampleHtml,
        }),
      })

      expect(response.status).toBe(202)
      const started = (await response.json()) as { job?: { id: string; status: string } }
      expect(started.job?.id).toBeTruthy()
      expect(started.job?.status).toBe('queued')

      const readResponse = await fetch(`${baseUrl}/api/generation-jobs/${started.job?.id}`)
      const read = (await readResponse.json()) as { job?: { id: string; status: string } }

      expect(readResponse.status).toBe(200)
      expect(read.job?.id).toBe(started.job?.id)
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = previousKey
      }
    }
  })

  it('rejects invalid generation job ids', async () => {
    const baseUrl = await startApi()

    const response = await fetch(`${baseUrl}/api/generation-jobs/not-a-uuid`)
    expect(response.status).toBe(400)
  })
})
