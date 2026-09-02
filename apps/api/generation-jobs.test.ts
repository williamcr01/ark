import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GenerationJob } from '@ark/chat/generation-job.ts'
import { createAssetStore } from '@ark/storage/stores/asset-store.ts'
import { createChatStore } from '@ark/storage/stores/chat-store.ts'
import { createDeckStore } from '@ark/storage/stores/deck-store.ts'
import type { RunDeckAgentResult } from '@ark/agent/agent.ts'
import { createGenerationJobRunner } from '@ark/agent/job-runner.ts'
import { createGenerationJobStore } from '@ark/storage/stores/generation-job-store.ts'
import { stubValidDeckValidation } from './test-utils.ts'
import { createWorkspaceStore, type WorkspaceStore } from '@ark/storage/stores/workspace-store.ts'

const html = `<!DOCTYPE html><html><head><title>Generated Deck</title></head><body><section class="slide"><h1>Hello</h1></section></body></html>`

const success = (nextHtml = html, changed = true): RunDeckAgentResult => ({
  ok: true,
  html: nextHtml,
  changed,
  validation: stubValidDeckValidation,
  steps: [],
  assistantText: changed ? 'Updated the deck.' : 'No document change needed.',
  transcriptParts: [],
  providerMetrics: {
    latencyMs: 0,
    model: 'openai:gpt-test',
    provider: 'openai',
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    finishReason: 'stop',
    retryCount: 0,
    errorCategory: null,
  },
})

async function terminal(getJob: (id: string) => Promise<GenerationJob | null>, id: string) {
  let job: GenerationJob | null = null
  await vi.waitFor(
    async () => {
      job = await getJob(id)
      expect(['succeeded', 'failed', 'canceled']).toContain(job?.status)
    },
    { timeout: 5_000, interval: 20 },
  )
  return job!
}

describe('generation job runner', () => {
  let directory = ''
  let workspaces: WorkspaceStore | null = null

  afterEach(async () => {
    workspaces?.close()
    workspaces = null
    if (directory) await rm(directory, { recursive: true, force: true })
    directory = ''
  })

  async function setup(
    runAgent: NonNullable<Parameters<typeof createGenerationJobRunner>[0]['runAgent']>,
  ) {
    directory = await mkdtemp(path.join(os.tmpdir(), 'ark-generation-'))
    workspaces = createWorkspaceStore(directory)
    const deckStore = createDeckStore(workspaces)
    const chatStore = createChatStore(workspaces)
    const assetStore = createAssetStore(workspaces)
    const jobStore = createGenerationJobStore()
    const runner = createGenerationJobRunner({
      deckStore,
      chatStore,
      assetStore,
      jobStore,
      runAgent,
      createModel: () => ({ model: {} as never, provider: 'openai', modelId: 'gpt-test' }),
      assertModelAvailable: async (modelRef) => ({
        id: modelRef,
        provider: 'openai',
        modelId: modelRef.split(':')[1] ?? modelRef,
        available: true,
        supportsAttachments: true,
      }),
    })
    return { assetStore, chatStore, deckStore, jobStore, runner }
  }

  it('creates a new .ark workspace for a successful unscoped job', async () => {
    const { deckStore, jobStore, runner } = await setup(async () => success())
    const started = await runner.startJob({
      body: { messages: [{ role: 'user', content: 'Make slides' }], currentHtml: '' },
      defaultModel: 'openai:gpt-test',
    })
    const finished = await terminal(jobStore.getJob, started.id)
    expect(finished).toMatchObject({ status: 'succeeded', result: { documentRevision: 1 } })
    expect(await deckStore.listDecks()).toEqual([
      expect.objectContaining({ id: finished.deckId, documentRevision: 1 }),
    ])
  })

  it('updates the current workspace document and chat transcript', async () => {
    const nextHtml = html.replace('Hello', 'Updated')
    const { chatStore, deckStore, jobStore, runner } = await setup(async () => success(nextHtml))
    const deck = await deckStore.createDeck(html)
    const started = await runner.startJob({
      body: {
        deckId: deck.id,
        baseDocumentRevision: 1,
        currentHtml: deck.html,
        messages: [{ role: 'user', content: 'Update it' }],
      },
      defaultModel: 'openai:gpt-test',
    })
    const finished = await terminal(jobStore.getJob, started.id)
    expect(finished).toMatchObject({ status: 'succeeded', result: { documentRevision: 2 } })
    expect((await deckStore.getDeck(deck.id))?.html).toContain('Updated')
    expect((await chatStore.listMessages(deck.id)).messages.at(-1)?.role).toBe('assistant')
  })

  it('runs a blank deck as a new deck, then as an existing one after the first write', async () => {
    const blank = `<!DOCTYPE html><html><head><title>Untitled Presentation</title></head><body><section class="slide"></section></body></html>`
    const origins: Array<unknown> = []
    const { deckStore, jobStore, runner } = await setup(async (options) => {
      origins.push(options.deckOrigin)
      return success()
    })
    const deck = await deckStore.createDeck(blank, { origin: 'blank' })

    const first = await runner.startJob({
      body: {
        deckId: deck.id,
        baseDocumentRevision: 1,
        currentHtml: deck.html,
        messages: [{ role: 'user', content: 'Make slides' }],
      },
      defaultModel: 'openai:gpt-test',
    })
    await terminal(jobStore.getJob, first.id)

    expect(origins).toEqual(['blank'])
    expect(await jobStore.getJob(first.id)).toMatchObject({
      request: { editingExistingDeck: false },
    })
    expect((await deckStore.getDeck(deck.id))?.origin).toBe('authored')

    const second = await runner.startJob({
      body: {
        deckId: deck.id,
        baseDocumentRevision: 2,
        currentHtml: html,
        messages: [{ role: 'user', content: 'Now tighten it' }],
      },
      defaultModel: 'openai:gpt-test',
    })
    await terminal(jobStore.getJob, second.id)

    expect(origins).toEqual(['blank', 'authored'])
    expect(await jobStore.getJob(second.id)).toMatchObject({
      request: { editingExistingDeck: true },
    })
  })

  it('rejects a stale document revision instead of overwriting newer content', async () => {
    const { deckStore, jobStore, runner } = await setup(async () =>
      success(html.replace('Hello', 'AI')),
    )
    const deck = await deckStore.createDeck(html)
    await deckStore.updateDeck(deck.id, html.replace('Hello', 'Manual'), {
      expectedDocumentRevision: deck.documentRevision,
    })
    const started = await runner.startJob({
      body: {
        deckId: deck.id,
        baseDocumentRevision: 1,
        currentHtml: deck.html,
        messages: [{ role: 'user', content: 'Update it' }],
      },
      defaultModel: 'openai:gpt-test',
    })
    await expect(terminal(jobStore.getJob, started.id)).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'document_conflict' },
    })
    expect((await deckStore.getDeck(deck.id))?.html).toContain('Manual')
  })

  it('surfaces a commit-time revision conflict instead of classifying it as a provider failure', async () => {
    const { deckStore, jobStore, runner } = await setup(async () =>
      success(html.replace('Hello', 'AI')),
    )
    const deck = await deckStore.createDeck(html)
    const originalUpdate = deckStore.updateDeck.bind(deckStore)
    let injectConcurrentWrite = true
    deckStore.updateDeck = async (id, nextHtml, options) => {
      if (injectConcurrentWrite) {
        injectConcurrentWrite = false
        await originalUpdate(id, html.replace('Hello', 'Manual'), options)
      }
      return originalUpdate(id, nextHtml, options)
    }
    const started = await runner.startJob({
      body: {
        deckId: deck.id,
        baseDocumentRevision: 1,
        currentHtml: deck.html,
        messages: [{ role: 'user', content: 'Update it' }],
      },
      defaultModel: 'openai:gpt-test',
    })

    await expect(terminal(jobStore.getJob, started.id)).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'document_conflict', errorCategory: 'document_conflict' },
    })
    expect((await deckStore.getDeck(deck.id))?.html).toContain('Manual')
  })

  it('resolves workspace assets for the model without persisting data URLs in chat', async () => {
    let captured: unknown
    const { assetStore, deckStore, jobStore, runner } = await setup(async (options) => {
      captured = options.messages
      return success(html, false)
    })
    const deck = await deckStore.createDeck(html)
    const asset = await assetStore.createAsset({
      deckId: deck.id,
      filename: 'notes.txt',
      mediaType: 'text/plain',
      category: 'text',
      source: 'upload',
      bytes: Buffer.from('Revenue grew 20%'),
    })
    const started = await runner.startJob({
      body: {
        deckId: deck.id,
        baseDocumentRevision: 1,
        currentHtml: deck.html,
        assetIds: [asset.id],
        messages: [{ role: 'user', content: 'Use the notes' }],
      },
      defaultModel: 'openai:gpt-test',
    })
    await terminal(jobStore.getJob, started.id)
    expect(JSON.stringify(captured)).toContain(asset.id)
  })

  it('can stop for user input without creating an empty workspace', async () => {
    const { deckStore, jobStore, runner } = await setup(async () => ({
      ...success('', false),
      awaitingUserResponse: true,
      assistantText: 'Who is the audience?',
    }))
    const started = await runner.startJob({
      body: { messages: [{ role: 'user', content: 'Make slides' }], currentHtml: '' },
      defaultModel: 'openai:gpt-test',
    })
    await expect(terminal(jobStore.getJob, started.id)).resolves.toMatchObject({
      status: 'succeeded',
      deckId: null,
      result: null,
    })
    await expect(deckStore.listDecks()).resolves.toEqual([])
  })

  it('persists body editorSelections when the message only sent singular context', async () => {
    const { chatStore, deckStore, jobStore, runner } = await setup(async () => success(html, false))
    const deck = await deckStore.createDeck(html)
    const editorSelections = [
      { slideIndex: 0, elementId: 'ark-el-a' },
      { slideIndex: 0, elementId: 'ark-el-b' },
      { slideIndex: 0, elementId: 'ark-el-c' },
    ]
    const started = await runner.startJob({
      body: {
        deckId: deck.id,
        baseDocumentRevision: 1,
        currentHtml: deck.html,
        editorSelection: editorSelections[0],
        editorSelections,
        messages: [
          {
            role: 'user',
            content: 'align these',
            context: { editorSelection: editorSelections[0] },
          },
        ],
      },
      defaultModel: 'openai:gpt-test',
    })
    await terminal(jobStore.getJob, started.id)
    const user = (await chatStore.listMessages(deck.id)).messages.find(
      (message) => message.role === 'user',
    )
    expect(user?.context?.editorSelections?.map((item) => item.elementId)).toEqual([
      'ark-el-a',
      'ark-el-b',
      'ark-el-c',
    ])
    expect(user?.context?.editorSelection?.elementId).toBe('ark-el-a')
    expect(started.request.editorSelections?.map((item) => item.elementId)).toEqual([
      'ark-el-a',
      'ark-el-b',
      'ark-el-c',
    ])
  })

  it('cancels queued jobs in memory', async () => {
    const { jobStore, runner } = await setup(async () => new Promise(() => undefined))
    const job = await jobStore.createJob({
      deckId: null,
      baseDocumentRevision: null,
      model: 'openai:gpt-test',
      provider: 'openai',
      request: { messages: [{ role: 'user', content: 'Make slides' }], currentHtml: '' },
    })
    await expect(runner.cancelJob(job.id)).resolves.toMatchObject({ status: 'canceled' })
  })
})
