import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { GenerationJob, GenerationJobStatus } from '@ark/deck-core/generation-job.ts'

import { createApp } from './app.ts'
import { runDeckAgent, type RunDeckAgentResult } from './deck-agent.ts'
import { createAssetStore } from './asset-store.ts'
import { createAssetStorageKey, createLocalAssetStorage } from './asset-storage.ts'
import { createChatStore } from './chat-store.ts'
import { createDeckStore } from './deck-store.ts'
import { stubStaticRuntimeManifest, stubValidDeckValidation } from './test-utils.ts'

const fastDeckOptions = { runtimeManifest: stubStaticRuntimeManifest } as const
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
  let rootDir = ''
  let deckStore: ReturnType<typeof createDeckStore>
  let jobStore: ReturnType<typeof createGenerationJobStore>
  let chatStore: ReturnType<typeof createChatStore>
  let assetStore: ReturnType<typeof createAssetStore>
  let assetStorage: ReturnType<typeof createLocalAssetStorage>

  beforeAll(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'ark-runner-'))
    deckStore = createDeckStore(path.join(rootDir, 'decks'))
    jobStore = createGenerationJobStore(path.join(rootDir, 'jobs'))
    chatStore = createChatStore(path.join(rootDir, 'chat'))
    assetStore = createAssetStore(path.join(rootDir, 'asset-meta'))
    assetStorage = createLocalAssetStorage(path.join(rootDir, 'asset-blobs'))
  })

  afterAll(async () => {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  function createRunner(options?: {
    runAgent?: (options: Parameters<typeof runDeckAgent>[0]) => Promise<RunDeckAgentResult>
  }) {
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

  it('succeeds a new-deck ask_user stop without creating a deck', async () => {
    const askUserParts = [
      {
        type: 'tool-call' as const,
        toolName: 'ask_user',
        summary: '2 question(s)',
        stepIndex: 0,
        toolCallId: 'ask-1',
        input: {
          title: 'Shape your presentation',
          questions: [
            { id: 'audience', question: 'Who is the audience?', type: 'text' },
            {
              id: 'length',
              question: 'How many slides?',
              type: 'single',
              options: ['5 slides', '10 slides'],
            },
          ],
        },
      },
      {
        type: 'tool-result' as const,
        toolName: 'ask_user',
        summary: 'Waiting for user answers',
        stepIndex: 0,
        toolCallId: 'ask-1',
        output: { ok: true, awaitingUserResponse: true },
      },
    ]

    const { deckStore, runner, jobStore } = await createRunner({
      runAgent: async () => ({
        ok: true,
        html: '',
        changed: false,
        awaitingUserResponse: true,
        validation: stubValidDeckValidation,
        steps: [
          { type: 'tool-call', toolName: 'ask_user', summary: '2 question(s)' },
          { type: 'tool-result', toolName: 'ask_user', summary: 'Waiting for user answers' },
        ],
        transcriptParts: askUserParts,
        assistantText: 'A couple quick questions before I draft this.',
        providerMetrics: stubProviderMetrics,
      }),
    })

    const job = await runner.startJob({
      body: {
        messages: [{ role: 'user', content: 'Make a product launch deck' }],
        currentHtml: '',
      },
      defaultModel: 'openai:gpt-4.1-mini',
    })

    const succeeded = await waitForTerminalJob((id) => jobStore.getJob(id), job.id, {
      statuses: ['succeeded'],
    })

    expect(succeeded.result).toBeNull()
    expect(succeeded.deckId).toBeNull()
    expect(succeeded.progress.transcriptParts).toEqual(askUserParts)
    expect(await deckStore.listDecks()).toHaveLength(0)
  })

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

    const deck = await deckStore.createDeck(sampleHtml, fastDeckOptions)
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
        validation: stubValidDeckValidation,
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

    const deck = await deckStore.createDeck(sampleHtml, { ...fastDeckOptions, source: 'upload' })
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
        validation: stubValidDeckValidation,
        steps: [{ type: 'text', summary: assistantText }],
        assistantText,
        providerMetrics: stubProviderMetrics,
      }),
    })
    const deck = await deckStore.createDeck(sampleHtml, { ...fastDeckOptions, source: 'upload' })
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
    let capturedAttachmentCount = 0
    let resolveCaptured: () => void = () => {}
    const captured = new Promise<void>((resolve) => {
      resolveCaptured = resolve
    })

    const { assetStore, assetStorage, deckStore, runner } = createRunner({
      runAgent: async (options) => {
        capturedMessages = options.messages
        capturedAttachmentCount = options.attachmentInspector?.attachments.length ?? 0
        resolveCaptured()
        return { ok: false, error: 'stop', steps: [] }
      },
    })
    const deck = await deckStore.createDeck(sampleHtml, fastDeckOptions)
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
    expect(capturedAttachmentCount).toBe(1)
  })

  it('keeps prior text assets as references for attachment tools', async () => {
    let capturedMessages: unknown = null
    let resolveCaptured: () => void = () => {}
    const captured = new Promise<void>((resolve) => {
      resolveCaptured = resolve
    })

    const { assetStore, assetStorage, deckStore, runner } = createRunner({
      runAgent: async (options) => {
        capturedMessages = options.messages
        resolveCaptured()
        return { ok: false, error: 'stop', steps: [] }
      },
    })
    const deck = await deckStore.createDeck(sampleHtml, fastDeckOptions)
    const storageKey = createAssetStorageKey()
    const csvBytes = Buffer.from('name,value\none,1')
    await assetStorage.write(storageKey, csvBytes)
    const asset = await assetStore.createAsset({
      deckId: deck.id,
      chatMessageId: null,
      filename: 'data.csv',
      mediaType: 'text/csv',
      category: 'text',
      byteSize: csvBytes.length,
      checksum: 'test-checksum',
      source: 'upload',
      storageKind: 'local',
      storageKey,
    })

    const assetReference = {
      type: 'file' as const,
      mediaType: 'text/csv',
      filename: 'data.csv',
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
      mediaType: 'text/csv',
    })
    expect((messages[0]?.attachments?.[0] as { url?: string }).url).toBe(assetReference.url)
  })

  it('rejects startJob when assetIds cannot be resolved', async () => {
    const { runner, deckStore } = await createRunner()
    const deck = await deckStore.createDeck(sampleHtml, fastDeckOptions)

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

  it('claims temporary image assets and rewrites them when creating a deck', async () => {
    let temporaryUrl = ''
    const { assetStore, assetStorage, chatStore, deckStore, jobStore, runner } = await createRunner(
      {
        runAgent: async () => {
          const html = sampleHtml.replace(
            '<h1>Hello</h1>',
            `<h1>Hello</h1><img src="${temporaryUrl}" alt="Launch chart">`,
          )
          return {
            ok: true,
            html,
            validation: stubValidDeckValidation,
            steps: [],
            transcriptParts: [],
            assistantText: 'Added the launch chart.',
            providerMetrics: stubProviderMetrics,
          }
        },
      },
    )
    const storageKey = createAssetStorageKey()
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await assetStorage.write(storageKey, pngBytes)
    const asset = await assetStore.createAsset({
      deckId: null,
      filename: 'launch.png',
      mediaType: 'image/png',
      category: 'image',
      byteSize: pngBytes.length,
      checksum: 'temporary-checksum',
      source: 'upload',
      storageKind: 'local',
      storageKey,
    })
    temporaryUrl = `/api/assets/${asset.id}`

    const job = await runner.startJob({
      body: {
        messages: [
          {
            role: 'user',
            content: 'Use this chart',
            attachments: [
              {
                type: 'file',
                mediaType: 'image/png',
                filename: 'launch.png',
                url: temporaryUrl,
                assetId: asset.id,
              },
            ],
          },
        ],
        assetIds: [asset.id],
      },
      defaultModel: 'openai:gpt-4.1-mini',
    })
    const succeeded = await waitForTerminalJob((id) => jobStore.getJob(id), job.id, {
      statuses: ['succeeded'],
    })
    const deck = await deckStore.getDeck(succeeded.deckId!)
    const claimed = await assetStore.getAsset(asset.id)
    const chat = await chatStore.listMessages(succeeded.deckId!, { limit: 20 })

    expect(deck?.html).toContain(`/api/decks/${succeeded.deckId}/assets/${asset.id}`)
    expect(deck?.html).not.toContain(temporaryUrl)
    expect(claimed?.deckId).toBe(succeeded.deckId)
    expect(chat.messages[0]?.attachments?.[0]?.url).toBe(
      `/api/decks/${succeeded.deckId}/assets/${asset.id}`,
    )
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
      error: {
        message: 'Provider unavailable',
        code: 'provider_error',
        errorCategory: 'provider_error',
      },
      completedAt: new Date().toISOString(),
    })

    const retried = await runner.retryJob(failed.id)

    expect(retried?.retryOfJobId).toBe(failed.id)
    expect(retried?.status).toBe('queued')
    expect(retried?.request.messages.map((message) => message.content)).toEqual([
      'Retry me',
      'The model failed to generate the deck. Provider unavailable',
      'Retry previous request',
    ])

    if (retried) {
      await runner.cancelJob(retried.id)
      await waitForTerminalJob((id) => jobStore.getJob(id), retried.id, {
        statuses: ['canceled', 'failed', 'succeeded'],
      })
    }
  })

  it('persists the unsaved failure turn when a new-deck retry succeeds', async () => {
    const { chatStore, runner, jobStore } = await createRunner({
      runAgent: async () => ({
        ok: true,
        html: sampleHtml,
        validation: stubValidDeckValidation,
        steps: [],
        transcriptParts: [],
        assistantText: 'Here is the deck.',
        providerMetrics: stubProviderMetrics,
      }),
    })

    const failed = await jobStore.createJob({
      deckId: null,
      baseVersionId: null,
      model: 'openai:gpt-4.1-mini',
      provider: 'openai',
      request: {
        messages: [{ id: 'user-1', role: 'user', content: 'Make a pitch deck' }],
        currentHtml: '',
      },
    })

    await jobStore.updateJob(failed.id, {
      status: 'failed',
      error: {
        message: 'The provider rejected the request.',
        code: 'provider_error',
        errorCategory: 'provider_error',
      },
      completedAt: new Date().toISOString(),
    })

    const retried = await runner.retryJob(failed.id)
    expect(retried).not.toBeNull()

    const succeeded = await waitForTerminalJob((id) => jobStore.getJob(id), retried!.id, {
      statuses: ['succeeded'],
    })
    const persisted = await chatStore.listMessages(succeeded.result!.deckId)
    expect(persisted.messages.map((message) => message.content)).toEqual([
      'Make a pitch deck',
      'The model failed to generate the deck. The provider rejected the request.',
      'Retry previous request',
      expect.stringContaining('Here is the deck.'),
    ])
  })

  it('replays the persisted failed attempt transcript when retrying', async () => {
    const capturedRuns: Parameters<typeof runDeckAgent>[0]['messages'][] = []
    const { chatStore, deckStore, runner, jobStore } = await createRunner({
      runAgent: async (options) => {
        capturedRuns.push(options.messages)
        return {
          ok: false,
          error: 'Provider unavailable',
          steps: [],
          transcriptParts: [
            {
              type: 'text',
              content: 'Retry attempt also failed.',
              stepIndex: 0,
            },
          ],
        }
      },
    })
    const deck = await deckStore.createDeck(sampleHtml, { ...fastDeckOptions, source: 'upload' })
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

    expect(retried).toBeTruthy()
    await waitForTerminalJob((id) => runner.getJob(id), retried!.id, { statuses: ['failed'] })

    let persisted = await chatStore.listMessages(deck.id, { limit: 500 })
    await vi.waitFor(async () => {
      persisted = await chatStore.listMessages(deck.id, { limit: 500 })
      expect(persisted.messages).toHaveLength(3)
    })
    expect(persisted.messages.map(({ role }) => role)).toEqual(['assistant', 'user', 'assistant'])
    expect(persisted.messages[1]?.content).toBe('Retry previous request')

    const nextMessages = [
      ...persisted.messages.map(({ id, role, content, parts, attachments }) => ({
        id,
        role,
        content,
        ...(parts ? { parts } : {}),
        ...(attachments ? { attachments } : {}),
      })),
      { role: 'user' as const, content: 'Try a different edit now.' },
    ]
    const next = await runner.startJob({
      body: {
        deckId: deck.id,
        currentHtml: deck.html,
        messages: nextMessages,
        editingExistingDeck: true,
      },
      defaultModel: 'openai:gpt-4.1-mini',
    })
    await waitForTerminalJob((id) => runner.getJob(id), next.id, { statuses: ['failed'] })
    expect(capturedRuns).toHaveLength(2)
    expect(capturedRuns[1]?.map(({ role }) => role)).toEqual([
      'assistant',
      'user',
      'assistant',
      'user',
    ])
  })

  it('refreshes deck snapshot when retrying a failed edit job', async () => {
    const { deckStore, runner, jobStore } = await createRunner()
    const deck = await deckStore.createDeck(sampleHtml, { ...fastDeckOptions, source: 'upload' })
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
      ...fastDeckOptions,
      source: 'manual',
    })
    const retried = await runner.retryJob(failed.id)

    expect(retried?.baseVersionId).toBe(updatedDeck?.activeVersionId)
    expect(retried?.request.currentHtml).toBe(updatedDeck?.html)

    if (retried) {
      await runner.cancelJob(retried.id)
      await waitForTerminalJob((id) => jobStore.getJob(id), retried.id, {
        statuses: ['canceled', 'failed', 'succeeded'],
      })
    }
  })

  it('does not duplicate the latest user message when the client already persisted it', async () => {
    const { chatStore, deckStore, runner, jobStore } = await createRunner()
    const deck = await deckStore.createDeck(sampleHtml, { ...fastDeckOptions, source: 'upload' })
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
    await waitForTerminalJob((id) => jobStore.getJob(id), job.id, {
      statuses: ['canceled', 'failed', 'succeeded'],
    })
  })
})

describe('generation job API routes', () => {
  let apiRoot = ''
  let server: Server
  let baseUrl = ''
  let generationJobRunner: ReturnType<typeof createGenerationJobRunner>
  let jobStore: ReturnType<typeof createGenerationJobStore>
  let assetStore: ReturnType<typeof createAssetStore>
  let assetStorage: ReturnType<typeof createLocalAssetStorage>

  beforeAll(async () => {
    apiRoot = await mkdtemp(path.join(os.tmpdir(), 'ark-job-api-'))
    const deckStore = createDeckStore(path.join(apiRoot, 'decks'))
    jobStore = createGenerationJobStore(path.join(apiRoot, 'jobs'))
    assetStore = createAssetStore(path.join(apiRoot, 'assets', 'meta'))
    assetStorage = createLocalAssetStorage(path.join(apiRoot, 'assets', 'blobs'))
    generationJobRunner = createGenerationJobRunner({
      deckStore,
      jobStore,
      chatStore: null,
      assetStore,
      assetStorage,
      createModel: () => ({
        model: {} as never,
        provider: 'openai',
        modelId: 'gpt-4.1-mini',
      }),
      runAgent: stubAgentFailure,
    })

    const app = createApp({
      deckStore,
      assetStore,
      assetStorage,
      generationJobStore: jobStore,
      generationJobRunner,
    })

    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    await rm(apiRoot, { recursive: true, force: true })
  })

  it('starts and reads a generation job quickly', async () => {
    const previousKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-test-generation-job-route'

    try {
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
        const current = await jobStore.getJob(started.job.id)
        if (
          current &&
          !TERMINAL_JOB_STATUSES.includes(current.status as (typeof TERMINAL_JOB_STATUSES)[number])
        ) {
          await generationJobRunner.cancelJob(started.job.id)
          await waitForTerminalJob((id) => jobStore.getJob(id), started.job.id)
        }
      }
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = previousKey
      }
    }
  })

  it('starts a new-deck job with a temporary attachment', async () => {
    const previousKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-test-generation-job-route'

    try {
      const uploadResponse = await fetch(`${baseUrl}/api/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'notes.txt',
          mediaType: 'text/plain',
          data: 'data:text/plain;base64,SGVsbG8sIEFyayE=',
        }),
      })
      const upload = (await uploadResponse.json()) as { asset?: { id: string } }

      expect(uploadResponse.status).toBe(201)

      const response = await fetch(`${baseUrl}/api/generation-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Create a deck from the attached notes' }],
          assetIds: [upload.asset?.id],
        }),
      })

      expect(response.status).toBe(202)
      const started = (await response.json()) as { job?: { id: string } }
      expect(started.job?.id).toBeTruthy()

      if (started.job?.id) {
        const current = await jobStore.getJob(started.job.id)
        expect(current?.deckId).toBeNull()
        expect(current?.assetIds).toEqual([upload.asset?.id])
      }
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = previousKey
      }
    }
  })

  it('rejects invalid generation job ids', async () => {
    const response = await fetch(`${baseUrl}/api/generation-jobs/not-a-uuid`)
    expect(response.status).toBe(400)
  })
})
