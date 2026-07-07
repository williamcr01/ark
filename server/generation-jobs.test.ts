import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { createApp } from './app.ts'
import { runDeckAgent, type RunDeckAgentResult } from './deck-agent.ts'
import { createAssetStore } from './asset-store.ts'
import { createAssetStorageKey, createLocalAssetStorage } from './asset-storage.ts'
import { createChatStore } from './chat-store.ts'
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

const stubAgentFailure = async (): Promise<RunDeckAgentResult> => ({
  ok: false,
  error: 'Stubbed agent failure for tests.',
  steps: [],
})

describe('generation job runner', () => {
  let deckDir = ''
  let jobDir = ''
  let chatDir = ''

  afterEach(async () => {
    for (const dir of [deckDir, jobDir, chatDir]) {
      if (dir) {
        await rm(dir, { recursive: true, force: true })
      }
    }

    deckDir = ''
    jobDir = ''
    chatDir = ''
  })

  async function createRunner(options?: {
    runAgent?: (options: Parameters<typeof runDeckAgent>[0]) => Promise<RunDeckAgentResult>
    chatDir?: string
  }) {
    deckDir = await mkdtemp(path.join(os.tmpdir(), 'ark-runner-decks-'))
    jobDir = await mkdtemp(path.join(os.tmpdir(), 'ark-runner-jobs-'))
    chatDir = options?.chatDir ?? (await mkdtemp(path.join(os.tmpdir(), 'ark-runner-chat-')))

    const deckStore = createDeckStore(deckDir)
    const jobStore = createGenerationJobStore(jobDir)
    const chatStore = createChatStore(chatDir)

    const runner = createGenerationJobRunner({
      deckStore,
      jobStore,
      chatStore,
      createModel: () => ({
        model: {} as never,
        provider: 'openai',
        modelId: 'gpt-4.1-mini',
      }),
      runAgent: options?.runAgent ?? stubAgentFailure,
      now: () => new Date('2026-07-01T12:00:00.000Z'),
    })

    return { chatStore, deckStore, jobStore, runner }
  }

  it('marks canceled queued jobs without running the agent', async () => {
    const { runner, jobStore } = await createRunner({
      runAgent: () => new Promise(() => undefined),
    })

    const job = await jobStore.createJob({
      deckId: null,
      baseVersionId: null,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: {
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

  it('merges resolved asset attachments into the latest user model message at run time', async () => {
    let capturedMessages: unknown = null
    let resolveCaptured: () => void = () => {}
    const captured = new Promise<void>((resolve) => {
      resolveCaptured = resolve
    })

    deckDir = await mkdtemp(path.join(os.tmpdir(), 'ark-runner-decks-'))
    jobDir = await mkdtemp(path.join(os.tmpdir(), 'ark-runner-jobs-'))
    chatDir = await mkdtemp(path.join(os.tmpdir(), 'ark-runner-chat-'))
    const assetMetaDir = await mkdtemp(path.join(os.tmpdir(), 'ark-runner-asset-meta-'))
    const assetBlobDir = await mkdtemp(path.join(os.tmpdir(), 'ark-runner-asset-blobs-'))

    const deckStore = createDeckStore(deckDir)
    const jobStore = createGenerationJobStore(jobDir)
    const chatStore = createChatStore(chatDir)
    const assetStore = createAssetStore(assetMetaDir)
    const assetStorage = createLocalAssetStorage(assetBlobDir)
    const deck = await deckStore.createDeck(sampleHtml)
    const storageKey = createAssetStorageKey()
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await assetStorage.write(storageKey, pngBytes)
    const asset = await assetStore.createAsset({
      deckId: deck.id,
      chatMessageId: null,
      filename: 'chart.png',
      mediaType: 'image/png',
      category: 'image',
      byteSize: pngBytes.length,
      checksum: 'test-checksum',
      source: 'upload',
      storageKind: 'local',
      storageKey,
    })

    const runner = createGenerationJobRunner({
      deckStore,
      jobStore,
      chatStore,
      assetStore,
      assetStorage,
      createModel: () => ({
        model: {} as never,
        provider: 'openai',
        modelId: 'gpt-4.1-mini',
      }),
      runAgent: async (options) => {
        capturedMessages = options.messages
        resolveCaptured()
        return { ok: false, error: 'stop', steps: [] }
      },
      now: () => new Date('2026-07-01T12:00:00.000Z'),
    })

    const job = await runner.startJob({
      body: {
        messages: [{ role: 'user', content: 'Use the chart' }],
        deckId: deck.id,
        assetIds: [asset.id],
      },
      defaultModel: 'openai:gpt-4.1-mini',
    })

    await captured

    // Wait for the job to fully settle so cleanup does not race with writes.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const latest = await runner.getJob(job.id)
      if (latest && (latest.status === 'failed' || latest.status === 'canceled')) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    const stored = await runner.getJob(job.id)
    expect(stored?.request.messages.at(-1)?.attachments).toBeUndefined()
    expect(stored?.assetIds).toEqual([asset.id])

    const messages = capturedMessages as Array<{ role: string; attachments?: unknown[] }>
    expect(messages.at(-1)?.attachments).toHaveLength(1)
    expect(messages.at(-1)?.attachments?.[0]).toMatchObject({
      assetId: asset.id,
      mediaType: 'image/png',
      filename: 'chart.png',
    })
    expect(
      (messages.at(-1)?.attachments?.[0] as { url?: string }).url?.startsWith(
        'data:image/png;base64,',
      ),
    ).toBe(true)
  })

  it('does not overwrite a canceled queued job with running', async () => {
    const { jobStore } = await createRunner()

    const job = await jobStore.createJob({
      deckId: null,
      baseVersionId: null,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: {
        messages: [{ role: 'user', content: 'Make slides' }],
        currentHtml: '',
      },
    })

    const canceled = await jobStore.updateJobIfStatus(job.id, 'queued', {
      status: 'canceled',
      completedAt: new Date().toISOString(),
    })
    expect(canceled?.status).toBe('canceled')

    const claimed = await jobStore.claimQueuedJob(job.id, new Date().toISOString())
    expect(claimed).toBeNull()

    const stored = await jobStore.getJob(job.id)
    expect(stored?.status).toBe('canceled')
    expect(stored?.startedAt).toBeNull()
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

  it('refreshes deck snapshot when retrying a failed edit job', async () => {
    const { deckStore, runner, jobStore } = await createRunner()
    const deck = await deckStore.createDeck(sampleHtml, { source: 'upload' })
    const failed = await jobStore.createJob({
      deckId: deck.id,
      baseVersionId: deck.activeVersionId,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: {
        messages: [{ role: 'user', content: 'Retry me' }],
        currentHtml: deck.html,
        baseVersionId: deck.activeVersionId,
        editingExistingDeck: true,
      },
    })

    await jobStore.updateJob(failed.id, {
      status: 'failed',
      error: { message: 'Version conflict', code: 'version_conflict' },
      completedAt: new Date().toISOString(),
    })

    const updatedDeck = await deckStore.updateDeck(deck.id, sampleHtml.replace('Hello', 'Hi'), {
      source: 'manual',
    })
    const retried = await runner.retryJob(failed.id)

    expect(retried?.baseVersionId).toBe(updatedDeck?.activeVersionId)
    expect(retried?.request.currentHtml).toBe(updatedDeck?.html)

    if (retried) {
      await runner.cancelJob(retried.id)
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  })

  it('does not duplicate the latest user message when the client already persisted it', async () => {
    const { chatStore, deckStore, runner } = await createRunner()
    const deck = await deckStore.createDeck(sampleHtml, { source: 'upload' })
    const userMessageId = '00000000-0000-4000-8000-000000000101'

    await chatStore.appendMessage(deck.id, {
      id: userMessageId,
      role: 'user',
      content: 'Make the title larger',
      deckVersionId: deck.activeVersionId ?? null,
    })

    const job = await runner.startJob({
      defaultModel: 'openai:gpt-4.1-mini',
      body: {
        deckId: deck.id,
        baseVersionId: deck.activeVersionId ?? undefined,
        currentHtml: deck.html,
        messages: [
          {
            id: userMessageId,
            role: 'user',
            content: 'Make the title larger',
          },
        ],
      },
    })

    const chatAfterStart = await chatStore.listMessages(deck.id)

    expect(chatAfterStart.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(chatAfterStart.messages[0]).toMatchObject({
      id: userMessageId,
      role: 'user',
      content: 'Make the title larger',
    })

    await runner.cancelJob(job.id)
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
      chatStore: null,
      createModel: () => ({
        model: {} as never,
        provider: 'openai',
        modelId: 'gpt-4.1-mini',
      }),
      runAgent: stubAgentFailure,
    })

    const app = createApp({
      deckStore,
      generationJobStore: jobStore,
      generationJobRunner,
    })

    server = app.listen(0)
    await new Promise<void>((resolve) => server?.once('listening', resolve))

    const address = server.address() as AddressInfo
    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      generationJobRunner,
    }
  }

  it('starts and reads a generation job quickly', async () => {
    const previousKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-test-generation-job-route'

    try {
      const { baseUrl, generationJobRunner } = await startApi()

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
      const read = (await readResponse.json()) as {
        job?: { id: string; status: string; result?: { html?: string } | null }
      }

      expect(readResponse.status).toBe(200)
      expect(read.job?.id).toBe(started.job?.id)
      expect(read.job?.result?.html).toBeUndefined()

      if (started.job?.id) {
        await generationJobRunner.cancelJob(started.job.id)
      }

      await new Promise((resolve) => setTimeout(resolve, 25))
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = previousKey
      }
    }
  })

  it('rejects invalid generation job ids', async () => {
    const { baseUrl } = await startApi()

    const response = await fetch(`${baseUrl}/api/generation-jobs/not-a-uuid`)
    expect(response.status).toBe(400)
  })
})
