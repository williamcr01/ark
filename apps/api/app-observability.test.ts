import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { assertApiContract, deckPatchResponseSchema } from '@ark/contracts'
import { createApp } from './app.ts'
import { createChatStore } from '@ark/storage/stores/chat-store.ts'
import { createDeckStore } from '@ark/storage/stores/deck-store.ts'
import { createGenerationJobStore } from '@ark/storage/stores/generation-job-store.ts'
import { createGenerationJobRunner } from '@ark/agent/job-runner.ts'
import { type RunDeckAgentResult } from '@ark/agent/agent.ts'
import { validateDeckHtmlOnServer } from '@ark/deck/validate/timed.ts'
import { REQUEST_ID_HEADER } from '@ark/telemetry/request-id.ts'
import { createRuntimeErrorStore } from './observability/runtime-errors.ts'
import { createWorkspaceStore, type WorkspaceStore } from '@ark/storage/stores/workspace-store.ts'

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

const deckId = '22222222-2222-4222-8222-222222222222'

describe('API observability', () => {
  let dataDir = ''
  let server: Server | null = null
  let workspaces: WorkspaceStore | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()))
      })
      server = null
    }

    workspaces?.close()
    workspaces = null
    if (dataDir) await rm(dataDir, { recursive: true, force: true })

    dataDir = ''
  })

  async function startServer(options?: { runAgent?: () => Promise<RunDeckAgentResult> }) {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-obs-decks-'))
    const runtimeErrorStore = createRuntimeErrorStore()
    workspaces = createWorkspaceStore(dataDir)
    const deckStore = createDeckStore(workspaces)
    const chatStore = createChatStore(workspaces)
    const jobStore = createGenerationJobStore()

    const runner = createGenerationJobRunner({
      deckStore,
      jobStore,
      chatStore,
      createModel: () => ({
        model: {} as never,
        provider: 'openai',
        modelId: 'gpt-4.1-mini',
      }),
      runAgent:
        options?.runAgent ??
        (async (): Promise<RunDeckAgentResult> => ({
          ok: true,
          html: sampleHtml,
          validation: validateDeckHtmlOnServer(sampleHtml),
          steps: [],
          assistantText: 'Done',
          providerMetrics: {
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
          },
        })),
      now: () => new Date('2026-07-01T12:00:00.000Z'),
    })

    const app = createApp({
      deckStore,
      chatStore,
      workspaceStore: workspaces,
      generationJobStore: jobStore,
      generationJobRunner: runner,
      runtimeErrorStore,
    })

    server = app.listen(0)
    await new Promise<void>((resolve) => server?.once('listening', resolve))

    const address = server.address() as AddressInfo

    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      runtimeErrorStore,
    }
  }

  it('returns and echoes request ids on success and error responses', async () => {
    const { baseUrl } = await startServer()
    const requestId = '33333333-3333-4333-8333-333333333333'

    const health = await fetch(`${baseUrl}/api/health`, {
      headers: {
        [REQUEST_ID_HEADER]: requestId,
      },
    })

    expect(health.headers.get(REQUEST_ID_HEADER)).toBe(requestId)
    await expect(health.json()).resolves.toMatchObject({
      ok: true,
      requestId,
    })

    const invalidDeck = await fetch(`${baseUrl}/api/decks/not-a-uuid`)
    const invalidDeckBody = (await invalidDeck.json()) as { error: string; requestId: string }

    expect(invalidDeck.status).toBe(400)
    expect(invalidDeck.headers.get(REQUEST_ID_HEADER)).toBeTruthy()
    expect(invalidDeckBody.requestId).toBe(invalidDeck.headers.get(REQUEST_ID_HEADER))
    expect(invalidDeckBody.error).toContain('Invalid deck id')
  })

  it('captures provider metadata on generation jobs', async () => {
    const previousKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-test-key'

    try {
      const { baseUrl } = await startServer()
      const response = await fetch(`${baseUrl}/api/generation-jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Make a deck' }],
        }),
      })

      expect(response.status).toBe(202)

      const payload = (await response.json()) as {
        job: {
          id: string
          observability: {
            requestId: string | null
            providerMetrics: {
              latencyMs: number
              tokenUsage: { totalTokens: number }
            } | null
          } | null
        }
        requestId: string
      }

      const jobId = payload.job.id

      let finalJob = payload.job

      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (finalJob.observability?.providerMetrics) {
          break
        }

        await new Promise((resolve) => setTimeout(resolve, 25))
        const poll = await fetch(`${baseUrl}/api/generation-jobs/${jobId}`)
        const pollBody = (await poll.json()) as { job: typeof finalJob }
        finalJob = pollBody.job
      }

      expect(finalJob.observability?.providerMetrics?.latencyMs).toBe(42)
      expect(finalJob.observability?.providerMetrics?.tokenUsage?.totalTokens).toBe(30)
      expect(payload.requestId).toBeTruthy()
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = previousKey
      }
    }
  })

  it('accepts sanitized runtime error reports', async () => {
    const { baseUrl, runtimeErrorStore } = await startServer()

    const response = await fetch(`${baseUrl}/api/runtime-errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deckId,
        message: 'Uncaught TypeError: Cannot read properties of undefined',
        runtimeMode: 'reveal',
        slideIndex: 2,
        severity: 'error',
        source: 'deck-preview',
        stack: 'at render (<anonymous>)',
      }),
    })

    expect(response.status).toBe(201)

    const body = (await response.json()) as { id: string; requestId: string }
    const stored = runtimeErrorStore.listForDeck(deckId, 1)[0]

    expect(body.id).toBe(stored.id)
    expect(stored.message).toContain('TypeError')
    expect(stored.slideIndex).toBe(2)
    expect(stored.runtimeMode).toBe('reveal')
    expect(body.requestId).toBeTruthy()
  })

  it('logs deck.patch.completed phase timings without changing the patch response', async () => {
    const entries: Array<Record<string, unknown>> = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => {
      for (const arg of args) {
        if (typeof arg === 'string' && arg.startsWith('{')) {
          try {
            entries.push(JSON.parse(arg) as Record<string, unknown>)
          } catch {
            // ignore non-JSON stdout
          }
        }
      }
      originalLog.apply(console, args as unknown as Parameters<typeof console.log>)
    }

    try {
      const { baseUrl } = await startServer()
      const created = await fetch(`${baseUrl}/api/decks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: sampleHtml }),
      })
      const createdBody = (await created.json()) as { deck: { id: string } }
      const patchResponse = await fetch(`${baseUrl}/api/decks/${createdBody.deck.id}/patch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedDocumentRevision: 1,
          operations: [{ op: 'update_slide_title', slideIndex: 0, title: 'Timed' }],
        }),
      })
      const patched = (await patchResponse.json()) as {
        deck: { html: string; documentRevision: number }
        patch: { appliedCount: number }
      }

      expect(patchResponse.status).toBe(200)
      assertApiContract(deckPatchResponseSchema, patched)
      expect(patched.deck.documentRevision).toBe(2)
      expect(patched.deck.html).toContain('Timed')
      expect(patched.patch.appliedCount).toBe(1)
      expect(patched).not.toHaveProperty('timings')
      for (const extra of [
        'loadMs',
        'applyMs',
        'validateMs',
        'persistMs',
        'notifyMs',
        'serializeMs',
        'htmlBytes',
        'reusedValidation',
      ]) {
        expect(patched).not.toHaveProperty(extra)
      }

      const patchLog = entries.find((entry) => entry.event === 'deck.patch.completed') as
        | {
            durationMs: number
            fields: {
              loadMs: number
              applyMs: number
              validateMs: number
              persistMs: number
              notifyMs: number
              serializeMs: number
              htmlBytes: number
              reusedValidation: boolean
              appliedCount: number
            }
          }
        | undefined

      expect(patchLog).toBeDefined()
      expect(patchLog?.fields.reusedValidation).toBe(true)
      expect(patchLog?.fields.appliedCount).toBe(1)
      expect(patchLog?.fields.htmlBytes).toBeGreaterThan(0)
      expect(patchLog?.fields.loadMs).toBeGreaterThanOrEqual(0)
      expect(patchLog?.fields.applyMs).toBeGreaterThanOrEqual(0)
      expect(patchLog?.fields.validateMs).toBeGreaterThanOrEqual(0)
      expect(patchLog?.fields.persistMs).toBeGreaterThanOrEqual(0)
      expect(patchLog?.fields.notifyMs).toBeGreaterThanOrEqual(0)
      expect(patchLog?.fields.serializeMs).toBeGreaterThanOrEqual(0)
      expect(patchLog?.durationMs).toBeGreaterThanOrEqual(patchLog?.fields.applyMs ?? 0)
    } finally {
      console.log = originalLog
    }
  })
})
