import { randomUUID } from 'node:crypto'

import type { GenerationJob } from '@ark/chat/generation-job.ts'
import type { Logger } from '@ark/telemetry/logger.ts'
import type { DeckStore } from '@ark/storage/records/deck-record.ts'
import type { ChatStore, ChatThread, StoredChatMessage } from '@ark/storage/records/chat-record.ts'
import type { AssetRecord, AssetStore } from '@ark/storage/records/asset-record.ts'
import type { StoredDeck } from '@ark/deck/document/stored-deck.ts'
import { createGenerationJobStore } from '@ark/storage/stores/generation-job-store.ts'
import type { RunDeckAgentResult } from '../agent.ts'
import { createJobContext, type JobContext, type JobRunnerDeps } from './context.ts'
import { createJobControllerRegistry } from './controller-registry.ts'

export const FIXED_NOW = '2026-01-01T00:00:00.000Z'
export const DECK_ID = 'c0000000-0000-4000-8000-000000000001'
export const JOB_ID = 'b0000000-0000-4000-8000-000000000002'
export const ASSET_ID = 'a0000000-0000-4000-8000-000000000099'
export const THREAD_ID = 'd0000000-0000-4000-8000-000000000003'

export const SAMPLE_HTML = `<!DOCTYPE html><html><head><title>Generated Deck</title></head><body><section class="slide"><h1>Hello</h1></section></body></html>`

export const stubValidDeckValidation = {
  valid: true,
  slideCount: 1,
  scripts: [],
  forms: 0,
  iframes: 0,
  externalUrls: [],
  malformedSlides: [],
  runtimeMarkers: {
    runtimeMode: 'static' as const,
    arkDeck: null,
    arkPreview: null,
    arkRuntime: null,
    arkRuntimeLib: null,
    arkRuntimeVersion: null,
    approvedRuntimeId: null,
    approvedRuntimeVersion: null,
  },
  issues: [],
}

export function silentLogger(): Logger {
  return {
    log() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
  }
}

export function successAgentResult(
  html = SAMPLE_HTML,
  changed = true,
): Extract<RunDeckAgentResult, { ok: true }> {
  return {
    ok: true,
    html,
    changed,
    validation: stubValidDeckValidation,
    steps: [],
    assistantText: changed ? 'Updated the deck.' : 'No document change needed.',
    transcriptParts: [
      { type: 'text', content: changed ? 'Updated the deck.' : 'No document change needed.' },
    ],
    providerMetrics: {
      latencyMs: 10,
      model: 'openai:gpt-test',
      provider: 'openai',
      tokenUsage: null,
      finishReason: 'stop',
      retryCount: 0,
      errorCategory: null,
    },
  }
}

export function failedAgentResult(
  error = 'Provider failed.',
): Extract<RunDeckAgentResult, { ok: false }> {
  return {
    ok: false,
    error,
    steps: [],
    transcriptParts: [],
    providerMetrics: {
      latencyMs: 10,
      model: 'openai:gpt-test',
      provider: 'openai',
      errorCategory: 'provider_error',
    },
  }
}

export function createMemoryDeckStore(initial: StoredDeck[] = []): DeckStore & {
  decks: Map<string, StoredDeck>
} {
  const decks = new Map(initial.map((deck) => [deck.id, deck]))
  return {
    decks,
    async createDeck(html, options, id) {
      const deck: StoredDeck = {
        id: id ?? randomUUID(),
        html,
        title: 'Deck',
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        documentRevision: 1,
        origin: options?.origin ?? 'authored',
        filePath: `/tmp/${id ?? 'deck'}.ark`,
      }
      decks.set(deck.id, deck)
      return { ...deck }
    },
    async getDeck(id) {
      const deck = decks.get(id)
      return deck ? { ...deck } : null
    },
    async listDecks() {
      return [...decks.values()].map((deck) => ({
        id: deck.id,
        title: deck.title,
        createdAt: deck.createdAt,
        updatedAt: deck.updatedAt,
        documentRevision: deck.documentRevision,
        filePath: deck.filePath,
      }))
    },
    async updateDeck(id, html, options) {
      const existing = decks.get(id)
      if (!existing || existing.documentRevision !== options.expectedDocumentRevision) {
        return null
      }
      const updated: StoredDeck = {
        ...existing,
        html,
        documentRevision: existing.documentRevision + 1,
        origin: existing.origin === 'blank' ? 'authored' : existing.origin,
        updatedAt: FIXED_NOW,
      }
      decks.set(id, updated)
      return { ...updated }
    },
    async updateDeckMetadata() {
      return null
    },
    async deleteDeck(id) {
      return decks.delete(id)
    },
  }
}

export function storedDeck(overrides: Partial<StoredDeck> = {}): StoredDeck {
  return {
    id: DECK_ID,
    html: SAMPLE_HTML,
    title: 'Deck',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    documentRevision: 1,
    origin: 'authored',
    filePath: `/tmp/${DECK_ID}.ark`,
    ...overrides,
  }
}

type MemoryAsset = AssetRecord & { bytes: Buffer }

export function createMemoryAssetStore(initial: MemoryAsset[] = []): AssetStore & {
  records: Map<string, MemoryAsset>
} {
  const records = new Map(initial.map((record) => [`${record.deckId}:${record.id}`, record]))
  return {
    records,
    async createAsset() {
      throw new Error('unused')
    },
    async getAsset(deckId, id) {
      const record = records.get(`${deckId}:${id}`)
      return record ? { ...record } : null
    },
    async readBytes(deckId, id) {
      return records.get(`${deckId}:${id}`)?.bytes ?? null
    },
    async listAssetsByDeck(deckId) {
      return [...records.values()].filter((record) => record.deckId === deckId)
    },
    async addReference() {
      return true
    },
    async deleteAsset() {
      return null
    },
  }
}

export function memoryAsset(overrides: Partial<MemoryAsset> = {}): MemoryAsset {
  return {
    id: ASSET_ID,
    deckId: DECK_ID,
    chatMessageId: null,
    filename: 'notes.txt',
    mediaType: 'text/plain',
    category: 'text',
    byteSize: 16,
    checksum: 'abc',
    source: 'upload',
    createdAt: FIXED_NOW,
    bytes: Buffer.from('Revenue grew 20%'),
    ...overrides,
  }
}

export function createMemoryChatStore(): ChatStore & {
  messages: StoredChatMessage[]
  threads: Map<string, ChatThread>
} {
  const messages: StoredChatMessage[] = []
  const threads = new Map<string, ChatThread>()
  const threadFor = (deckId: string): ChatThread => {
    const existing = threads.get(deckId)
    if (existing) {
      return existing
    }
    const thread: ChatThread = {
      id: THREAD_ID,
      deckId,
      activeDocumentRevision: 1,
      title: 'Chat',
      status: 'active',
      visibility: 'private',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    }
    threads.set(deckId, thread)
    return thread
  }

  return {
    messages,
    threads,
    async listThreads(deckId) {
      const thread = threads.get(deckId)
      return thread ? [thread] : []
    },
    async createThread(deckId, title = 'Chat') {
      const thread: ChatThread = { ...threadFor(deckId), title }
      threads.set(deckId, thread)
      return thread
    },
    async updateThread() {
      return null
    },
    async deleteThread() {
      return false
    },
    async getOrCreateActiveThread(deckId) {
      return threadFor(deckId)
    },
    async getActiveThread(deckId) {
      return threads.get(deckId) ?? null
    },
    async listMessages(deckId) {
      return {
        thread: threads.get(deckId) ?? null,
        messages: messages.filter((message) => message.deckId === deckId),
        hasMore: false,
      }
    },
    async appendMessage(deckId, input) {
      const stored: StoredChatMessage = {
        id: input.id ?? randomUUID(),
        threadId: threadFor(deckId).id,
        deckId,
        documentRevision: null,
        role: input.role,
        content: input.content,
        parts: input.parts,
        attachments: input.attachments,
        context: input.context,
        generationJobId: input.generationJobId,
        generationStatus: input.generationStatus,
        model: input.model,
        error: input.error,
        createdAt: FIXED_NOW,
      }
      messages.push(stored)
      return stored
    },
    async clearThread() {
      return true
    },
  }
}

export function createTestDeps(overrides: Partial<JobRunnerDeps> = {}): JobRunnerDeps {
  return {
    deckStore: createMemoryDeckStore(),
    jobStore: createGenerationJobStore(),
    chatStore: createMemoryChatStore(),
    assetStore: createMemoryAssetStore(),
    createModel: () => ({ model: {} as never, provider: 'openai', modelId: 'gpt-test' }),
    assertModelAvailable: async (modelRef) => ({
      id: modelRef,
      provider: 'openai',
      modelId: modelRef.split(':')[1] ?? modelRef,
      available: true,
      supportsAttachments: true,
    }),
    runAgent: async () => successAgentResult(),
    now: () => new Date(FIXED_NOW),
    controllers: createJobControllerRegistry(),
    createLogger: () => silentLogger(),
    ...overrides,
  }
}

export function jobSnapshot(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: JOB_ID,
    deckId: DECK_ID,
    baseDocumentRevision: 1,
    chatThreadId: THREAD_ID,
    status: 'running',
    model: 'openai:gpt-test',
    provider: 'openai',
    request: {
      messages: [{ role: 'user', content: 'Make slides' }],
      currentHtml: SAMPLE_HTML,
      editingExistingDeck: true,
    },
    progress: { steps: [], stepCount: 0, assistantText: null },
    result: null,
    error: null,
    observability: null,
    retryOfJobId: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    startedAt: FIXED_NOW,
    completedAt: null,
    ...overrides,
  }
}

export function createTestContext(
  deps: JobRunnerDeps = createTestDeps(),
  job: GenerationJob = jobSnapshot(),
): JobContext {
  return createJobContext({
    job,
    deps,
    logger: silentLogger(),
    abortController: new AbortController(),
    requestId: 'req-1',
    jobStartedAt: 0,
  })
}
