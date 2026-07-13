import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GenerationJob, GenerationJobStatus } from '@ark/deck-core/generation-job.ts'

import { createApp } from './app.ts'
import { runDeckAgent, type RunDeckAgentResult } from './deck-agent.ts'
import { createAssetStore } from './asset-store.ts'
import { createAssetStorageKey, createLocalAssetStorage } from './asset-storage.ts'
import { createChatStore } from './chat-store.ts'
import { createDeckStore } from './deck-store.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'
import { createGenerationJobStore } from './generation-job-store.ts'
import { createGenerationJobRunner } from './generation-job-runner.ts'

const TERMINAL_JOB_STATUSES = [
  'succeeded',
  'failed',
  'canceled',
] as const satisfies readonly GenerationJobStatus[]

async function waitForTerminalJob(
  getJob: (id: string) => Promise<GenerationJob | null>,
  jobId: string,
  options: {
    statuses?: readonly GenerationJobStatus[]
    timeoutMs?: number
  } = {},
): Promise<GenerationJob> {
  const statuses = options.statuses ?? TERMINAL_JOB_STATUSES
  let latest: GenerationJob | null = null

  await vi.waitFor(
    async () => {
      latest = await getJob(jobId)
      expect(latest).toBeTruthy()
      expect(statuses).toContain(latest!.status)
    },
    {
      timeout: options.timeoutMs ?? 5_000,
      interval: 20,
    },
  )

  expect(latest).toBeTruthy()
  return latest as GenerationJob
}

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

const stubProviderMetrics = {
  latencyMs: 42,
  model: 'openai:gpt-4.1-mini',
  provider: 'openai',
  tokenUsage: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
  },
  finishReason: 'stop',
  retryCount: 0,
  errorCategory: null,
}

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
    const assetMetaDir = await mkdtemp(path.join(os.tmpdir(), 'ark-runner-asset-meta-'))
    const assetBlobDir = await mkdtemp(path.join(os.tmpdir(), 'ark-runner-asset-blobs-'))

    const deckStore = createDeckStore(deckDir)
    const jobStore = createGenerationJobStore(jobDir)
    const chatStore = createChatStore(chatDir)
    const assetStore = createAssetStore(assetMetaDir)
    const assetStorage = createLocalAssetStorage(assetBlobDir)

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
      runAgent: options?.runAgent ?? stubAgentFailure,
      now: () => new Date('2026-07-01T12:00:00.000Z'),
    })

    return { assetStore, assetStorage, chatStore, deckStore, jobStore, runner }
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

  it('threads editor selection context into the agent run and stores it on the job', async () => {
    let capturedSelection: unknown = 'unset'
    let resolveCaptured: () => void = () => {}
    const captured = new Promise<void>((resolve) => {
      resolveCaptured = resolve
    })

    const { runner } = await createRunner({
      runAgent: async (options) => {
        capturedSelection = options.editorSelection
        resolveCaptured()
        return { ok: false, error: 'stop', steps: [] }
      },
    })

    const editorSelection = {
      slideIndex: 1,
      slideId: 'ark-slide-1',
      elementId: 'ark-el-9',
      elementKind: 'text',
      textPreview: 'Headline',
      locked: false,
      managed: true,
    }

    const job = await runner.startJob({
      body: {
        messages: [{ role: 'user', content: 'make this punchier' }],
        currentHtml: sampleHtml,
        editorSelection,
      },
      defaultModel: 'openai:gpt-4.1-mini',
    })

    await captured

    // Let the job settle so temp-dir cleanup does not race with pending writes.
    await waitForTerminalJob((id) => runner.getJob(id), job.id, {
      statuses: ['failed', 'canceled'],
    })

    expect(capturedSelection).toMatchObject(editorSelection)

    const stored = await runner.getJob(job.id)
    expect(stored?.request.editorSelection).toMatchObject(editorSelection)
  })

  it('passes a version inspector into edit-existing-deck agent runs', async () => {
    let capturedInspector: unknown = 'unset'
    let resolveCaptured: () => void = () => {}
    const captured = new Promise<void>((resolve) => {
      resolveCaptured = resolve
    })

    const { deckStore, runner } = await createRunner({
      runAgent: async (options) => {
        capturedInspector = options.versionInspector
        resolveCaptured()
        return { ok: false, error: 'stop', steps: [] }
      },
    })

    const deck = await deckStore.createDeck(sampleHtml)
    const job = await runner.startJob({
      body: {
        deckId: deck.id,
        baseVersionId: deck.activeVersionId ?? undefined,
        currentHtml: deck.html,
        messages: [{ role: 'user', content: 'Review recent versions' }],
        editingExistingDeck: true,
      },
      defaultModel: 'openai:gpt-4.1-mini',
    })

    await captured

    await waitForTerminalJob((id) => runner.getJob(id), job.id, {
      statuses: ['failed', 'canceled'],
    })

    expect(capturedInspector).toBeTruthy()
    expect(typeof (capturedInspector as { listVersions?: unknown }).listVersions).toBe('function')
  })

  it('persists agent version provenance without HTML substrings', async () => {
    const updatedHtml = sampleHtml.replace('Hello', 'Agent updated')
    const htmlLeak = '<section class="slide"><h1>Secret deck HTML</h1></section>'
    const { deckStore, runner } = await createRunner({
      runAgent: async () => ({
        ok: true,
        html: updatedHtml,
        validation: validateDeckHtmlOnServer(updatedHtml),
        steps: [
          { type: 'text', summary: `Assistant said ${htmlLeak}` },
          { type: 'tool-call', toolName: 'patch_deck', summary: 'rename slide 0' },
          {
            type: 'tool-result',
            toolName: 'patch_deck',
            summary: `Applied patch with ${htmlLeak}`,
          },
        ],
        assistantText: 'Updated the headline.',
        providerMetrics: stubProviderMetrics,
      }),
    })

    const deck = await deckStore.createDeck(sampleHtml, { source: 'upload' })
    const job = await runner.startJob({
      body: {
        deckId: deck.id,
        baseVersionId: deck.activeVersionId ?? undefined,
        currentHtml: deck.html,
        messages: [{ role: 'user', content: 'Make the headline stronger' }],
        editingExistingDeck: true,
      },
      defaultModel: 'openai:gpt-4.1-mini',
    })

    await waitForTerminalJob((id) => runner.getJob(id), job.id)

    const versions = await deckStore.listVersions(deck.id)
    const active = versions?.find((version) => version.isActive)

    expect(active).toMatchObject({
      source: 'agent',
      modelProvider: 'openai',
      modelName: 'openai:gpt-4.1-mini',
      provenance: {
        jobId: job.id,
        stepCount: 3,
        toolCalls: [
          { toolName: 'patch_deck', summary: 'rename slide 0' },
          { toolName: 'patch_deck', summary: 'Applied patch with Secret deck HTML' },
        ],
      },
      diff: {
        kind: 'structural',
      },
    })
    expect(JSON.stringify(active?.provenance)).not.toContain('<section')
    expect(JSON.stringify(active?.provenance)).not.toContain('<!doctype')
  })

  it('succeeds unchanged selected-element explanations without creating a version', async () => {
    const assistantText = 'That selected element is locked, so I cannot change it directly.'
    const { chatStore, deckStore, runner } = await createRunner({
      runAgent: async () => ({
        ok: true,
        html: sampleHtml,
        changed: false,
        validation: validateDeckHtmlOnServer(sampleHtml),
        steps: [{ type: 'text', summary: assistantText }],
        assistantText,
        providerMetrics: stubProviderMetrics,
      }),
    })
    const deck = await deckStore.createDeck(sampleHtml, { source: 'upload' })
    const initialVersionId = deck.activeVersionId

    const job = await runner.startJob({
      body: {
        deckId: deck.id,
        baseVersionId: initialVersionId ?? undefined,
        currentHtml: deck.html,
        messages: [{ role: 'user', content: 'Make this selected thing better' }],
        editorSelection: {
          slideIndex: 0,
          elementId: 'ark-el-locked',
          locked: true,
        },
      },
      defaultModel: 'openai:gpt-4.1-mini',
    })

    const stored = await waitForTerminalJob((id) => runner.getJob(id), job.id)

    expect(stored.status).toBe('succeeded')
    expect(stored.result).toMatchObject({
      deckId: deck.id,
      versionId: initialVersionId,
      html: sampleHtml,
      assistantText,
    })

    const latestDeck = await deckStore.getDeck(deck.id)
    expect(latestDeck?.activeVersionId).toBe(initialVersionId)
    expect(latestDeck?.versionNumber).toBe(1)
    expect(latestDeck?.html).toBe(sampleHtml)

    const versions = await deckStore.listVersions(deck.id)
    expect(versions).toHaveLength(1)

    const chat = await chatStore.listMessages(deck.id)
    expect(chat.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: assistantText,
      deckVersionId: initialVersionId,
    })
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
    const stored = await waitForTerminalJob((id) => runner.getJob(id), job.id, {
      statuses: ['failed', 'canceled'],
    })
    expect(stored.request.messages.at(-1)?.attachments).toBeUndefined()
    expect(stored.assetIds).toEqual([asset.id])

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

  it('resolves asset references from prior user turns at run time', async () => {
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

    const assetReference = {
      type: 'file' as const,
      mediaType: 'image/png',
      filename: 'chart.png',
      url: `/api/decks/${deck.id}/assets/${asset.id}`,
      assetId: asset.id,
    }

    const job = await runner.startJob({
      body: {
        messages: [
          {
            role: 'user',
            content: 'Use the chart',
            attachments: [assetReference],
          },
          { role: 'assistant', content: 'Created the deck.' },
          { role: 'user', content: 'Add another slide from the chart' },
        ],
        deckId: deck.id,
      },
      defaultModel: 'openai:gpt-4.1-mini',
    })

    await captured

    await waitForTerminalJob((id) => runner.getJob(id), job.id, {
      statuses: ['failed', 'canceled'],
    })

    const messages = capturedMessages as Array<{ role: string; attachments?: unknown[] }>
    expect(messages[0]?.attachments?.[0]).toMatchObject({
      assetId: asset.id,
      mediaType: 'image/png',
    })
    expect(
      (messages[0]?.attachments?.[0] as { url?: string }).url?.startsWith('data:image/png;base64,'),
    ).toBe(true)
  })

  it('rejects startJob when assetIds cannot be resolved', async () => {
    const { runner, deckStore } = await createRunner()
    const deck = await deckStore.createDeck(sampleHtml)

    await expect(
      runner.startJob({
        body: {
          messages: [{ role: 'user', content: 'Use the chart' }],
          deckId: deck.id,
          assetIds: ['00000000-0000-4000-8000-000000000099'],
        },
        defaultModel: 'openai:gpt-4.1-mini',
      }),
    ).rejects.toThrow('One or more asset ids could not be resolved.')
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

  it('replays the persisted failed attempt transcript when retrying', async () => {
    const { chatStore, deckStore, runner, jobStore } = await createRunner()
    const deck = await deckStore.createDeck(sampleHtml, { source: 'upload' })
    const failed = await jobStore.createJob({
      deckId: deck.id,
      baseVersionId: deck.activeVersionId,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: {
        messages: [{ role: 'user', content: 'Retry this edit' }],
        currentHtml: deck.html,
        editingExistingDeck: true,
      },
    })
    const parts = [
      {
        type: 'tool-call' as const,
        toolName: 'read_deck',
        summary: 'slide 0',
        stepIndex: 0,
        toolCallId: 'call-1',
        input: { slideIndex: 0 },
      },
      {
        type: 'tool-result' as const,
        toolName: 'read_deck',
        summary: 'Title',
        stepIndex: 0,
        toolCallId: 'call-1',
        output: { title: 'Title' },
        isError: false,
      },
    ]
    await chatStore.appendMessage(deck.id, {
      id: failed.id,
      role: 'assistant',
      content: 'The attempt failed after inspection.',
      parts,
      generationJobId: failed.id,
      generationStatus: 'failed',
    })
    await jobStore.updateJob(failed.id, {
      status: 'failed',
      error: { message: 'Provider unavailable', code: 'provider_error' },
      completedAt: new Date().toISOString(),
    })

    const retried = await runner.retryJob(failed.id)
    expect(retried?.request.messages).toEqual([
      { role: 'user', content: 'Retry this edit' },
      expect.objectContaining({ role: 'assistant', parts }),
      expect.objectContaining({ role: 'user', content: expect.stringContaining('Retry') }),
    ])
    expect(retried?.request.messages[1]?.parts).not.toBe(parts)

    if (retried) await runner.cancelJob(retried.id)
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
