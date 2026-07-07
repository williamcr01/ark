/**
 * HTTP API contract drift prevention (#135).
 *
 * Exercises representative success and validation-error responses against the
 * Zod schemas in `packages/contracts/`. When a route changes its wire shape, update
 * the contract schema first, then adjust these tests — see packages/contracts/README.md.
 */
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertApiContract,
  apiErrorPayloadSchema,
  appendChatMessageResponseSchema,
  assetListResponseSchema,
  createDeckResponseSchema,
  deckChatResponseSchema,
  deckListResponseSchema,
  deckResponseSchema,
  deckValidationErrorResponseSchema,
  deckVersionListResponseSchema,
  generationJobResponseSchema,
  getPreviewSessionResponseSchema,
  healthResponseSchema,
  modelsResponseSchema,
  previewSessionResponseSchema,
  runtimeErrorResponseSchema,
  runtimeRegistryResponseSchema,
  deckAssetProxyBlockedResponseSchema,
  simpleErrorResponseSchema,
  uploadAssetResponseSchema,
} from '@ark/contracts'
import { type RunDeckAgentResult } from './deck-agent.ts'
import { createApp } from './app.ts'
import { createAssetStore } from './asset-store.ts'
import { createLocalAssetStorage } from './asset-storage.ts'
import { createChatStore } from './chat-store.ts'
import { createDeckStore } from './deck-store.ts'
import { createGenerationJobStore } from './generation-job-store.ts'
import { createGenerationJobRunner } from './generation-job-runner.ts'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Contract Deck</title>
</head>
<body>
  <section class="slide"><h1>Hello</h1></section>
</body>
</html>`

const externalUrlHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <script src="https://example.com/evil.js"></script>
</head>
<body>
  <section class="slide"><h1>Blocked</h1></section>
</body>
</html>`

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
const pngDataUrl = `data:image/png;base64,${PNG_BYTES.toString('base64')}`

const stubAgentFailure = async (): Promise<RunDeckAgentResult> => ({
  ok: false,
  error: 'Stubbed agent failure for contract tests.',
  steps: [],
})

type ContractApi = {
  baseUrl: string
}

describe('HTTP API contract drift prevention', () => {
  let root = ''
  let server: Server | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()))
      })
      server = null
    }

    if (root) {
      await rm(root, { recursive: true, force: true })
      root = ''
    }
  })

  async function startContractApi(): Promise<ContractApi> {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-api-contract-'))

    const deckStore = createDeckStore(path.join(root, 'decks'))
    const chatStore = createChatStore(path.join(root, 'chat'))
    const jobStore = createGenerationJobStore(path.join(root, 'jobs'))
    const assetStore = createAssetStore(path.join(root, 'assets', 'meta'))
    const assetStorage = createLocalAssetStorage(path.join(root, 'assets', 'blobs'))

    const generationJobRunner = createGenerationJobRunner({
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
      runAgent: stubAgentFailure,
    })

    const app = createApp({
      deckStore,
      chatStore,
      assetStore,
      assetStorage,
      generationJobStore: jobStore,
      generationJobRunner,
    })

    server = app.listen(0)
    await new Promise<void>((resolve) => server?.once('listening', resolve))

    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`

    return { baseUrl }
  }

  async function createDeck(baseUrl: string) {
    const response = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml, source: 'upload' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(201)
    assertApiContract(createDeckResponseSchema, payload)

    return payload.deck
  }

  it('matches health and models response contracts', async () => {
    const { baseUrl } = await startContractApi()

    const healthResponse = await fetch(`${baseUrl}/api/health`)
    const health = await healthResponse.json()

    expect(healthResponse.status).toBe(200)
    assertApiContract(healthResponseSchema, health)

    const modelsResponse = await fetch(`${baseUrl}/api/models`)
    const models = await modelsResponse.json()

    expect(modelsResponse.status).toBe(200)
    assertApiContract(modelsResponseSchema, models)
  })

  it('matches deck success and validation-error contracts', async () => {
    const { baseUrl } = await startContractApi()

    const invalidCreate = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '   ' }),
    })
    const invalidCreateBody = await invalidCreate.json()

    expect(invalidCreate.status).toBe(400)
    assertApiContract(simpleErrorResponseSchema, invalidCreateBody)

    const deck = await createDeck(baseUrl)

    const listResponse = await fetch(`${baseUrl}/api/decks`)
    const list = await listResponse.json()

    expect(listResponse.status).toBe(200)
    assertApiContract(deckListResponseSchema, list)

    const getResponse = await fetch(`${baseUrl}/api/decks/${deck.id}`)
    const fetched = await getResponse.json()

    expect(getResponse.status).toBe(200)
    assertApiContract(deckResponseSchema, fetched)

    const invalidIdResponse = await fetch(`${baseUrl}/api/decks/not-a-uuid`)
    const invalidIdBody = await invalidIdResponse.json()

    expect(invalidIdResponse.status).toBe(400)
    assertApiContract(simpleErrorResponseSchema, invalidIdBody)

    const validationErrorResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: externalUrlHtml, source: 'upload' }),
    })
    const validationErrorBody = await validationErrorResponse.json()

    expect(validationErrorResponse.status).toBe(400)
    assertApiContract(deckValidationErrorResponseSchema, validationErrorBody)

    const versionsResponse = await fetch(`${baseUrl}/api/decks/${deck.id}/versions`)
    const versions = await versionsResponse.json()

    expect(versionsResponse.status).toBe(200)
    assertApiContract(deckVersionListResponseSchema, versions)

    const missingResponse = await fetch(`${baseUrl}/api/decks/00000000-0000-4000-8000-000000000099`)
    const missingBody = await missingResponse.json()

    expect(missingResponse.status).toBe(404)
    assertApiContract(simpleErrorResponseSchema, missingBody)
  })

  it('matches chat success and validation-error contracts', async () => {
    const { baseUrl } = await startContractApi()
    const deck = await createDeck(baseUrl)

    const emptyChatResponse = await fetch(`${baseUrl}/api/decks/${deck.id}/chat`)
    const emptyChat = await emptyChatResponse.json()

    expect(emptyChatResponse.status).toBe(200)
    assertApiContract(deckChatResponseSchema, emptyChat)

    const invalidAppend = await fetch(`${baseUrl}/api/decks/${deck.id}/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    })
    const invalidAppendBody = await invalidAppend.json()

    expect(invalidAppend.status).toBe(400)
    assertApiContract(simpleErrorResponseSchema, invalidAppendBody)

    const appendResponse = await fetch(`${baseUrl}/api/decks/${deck.id}/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: 'Make it darker' }),
    })
    const appended = await appendResponse.json()

    expect(appendResponse.status).toBe(201)
    assertApiContract(appendChatMessageResponseSchema, appended)

    const chatResponse = await fetch(`${baseUrl}/api/decks/${deck.id}/chat`)
    const chat = await chatResponse.json()

    expect(chatResponse.status).toBe(200)
    assertApiContract(deckChatResponseSchema, chat)

    const missingDeckResponse = await fetch(
      `${baseUrl}/api/decks/00000000-0000-4000-8000-000000000099/chat/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: 'hello' }),
      },
    )
    const missingDeckBody = await missingDeckResponse.json()

    expect(missingDeckResponse.status).toBe(404)
    assertApiContract(simpleErrorResponseSchema, missingDeckBody)
  })

  it('matches preview session success and validation-error contracts', async () => {
    const { baseUrl } = await startContractApi()

    const invalidResponse = await fetch(`${baseUrl}/api/preview-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '   ' }),
    })
    const invalid = await invalidResponse.json()

    expect(invalidResponse.status).toBe(400)
    assertApiContract(simpleErrorResponseSchema, invalid)

    const createResponse = await fetch(`${baseUrl}/api/preview-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml }),
    })
    const created = await createResponse.json()

    expect(createResponse.status).toBe(201)
    assertApiContract(previewSessionResponseSchema, created)

    const getResponse = await fetch(`${baseUrl}/api/preview-sessions/${created.token}`)
    const session = await getResponse.json()

    expect(getResponse.status).toBe(200)
    assertApiContract(getPreviewSessionResponseSchema, session)

    const missingResponse = await fetch(`${baseUrl}/api/preview-sessions/missing-token`)
    const missingBody = await missingResponse.json()

    expect(missingResponse.status).toBe(404)
    assertApiContract(simpleErrorResponseSchema, missingBody)
  })

  it('matches generation job success and validation-error contracts', async () => {
    const { baseUrl } = await startContractApi()
    const previousKey = process.env.OPENAI_API_KEY

    const invalidBodyResponse = await fetch(`${baseUrl}/api/generation-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user' }] }),
    })
    const invalidBody = await invalidBodyResponse.json()

    if (invalidBodyResponse.status === 503) {
      assertApiContract(apiErrorPayloadSchema, invalidBody)
    } else {
      expect(invalidBodyResponse.status).toBe(400)
      assertApiContract(simpleErrorResponseSchema, invalidBody)
    }

    const invalidDeckIdResponse = await fetch(`${baseUrl}/api/generation-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Build slides' }],
        deckId: 'not-a-uuid',
      }),
    })
    const invalidDeckId = await invalidDeckIdResponse.json()

    if (invalidDeckIdResponse.status === 503) {
      assertApiContract(apiErrorPayloadSchema, invalidDeckId)
      return
    }

    expect(invalidDeckIdResponse.status).toBe(400)
    assertApiContract(simpleErrorResponseSchema, invalidDeckId)

    const invalidPollResponse = await fetch(`${baseUrl}/api/generation-jobs/not-a-uuid`)
    const invalidPoll = await invalidPollResponse.json()

    expect(invalidPollResponse.status).toBe(400)
    assertApiContract(simpleErrorResponseSchema, invalidPoll)

    process.env.OPENAI_API_KEY = 'sk-contract-test-key'

    try {
      const startResponse = await fetch(`${baseUrl}/api/generation-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Create a title slide' }],
          currentHtml: sampleHtml,
        }),
      })
      const started = await startResponse.json()

      expect(startResponse.status).toBe(202)
      assertApiContract(generationJobResponseSchema, started)

      const jobId = started.job.id

      const pollResponse = await fetch(`${baseUrl}/api/generation-jobs/${jobId}`)
      const polled = await pollResponse.json()

      expect(pollResponse.status).toBe(200)
      assertApiContract(generationJobResponseSchema, polled)

      const cancelResponse = await fetch(`${baseUrl}/api/generation-jobs/${jobId}/cancel`, {
        method: 'POST',
      })
      const canceled = await cancelResponse.json()

      expect(cancelResponse.status).toBe(200)
      assertApiContract(generationJobResponseSchema, canceled)

      const missingResponse = await fetch(
        `${baseUrl}/api/generation-jobs/00000000-0000-4000-8000-000000000099`,
      )
      const missingBody = await missingResponse.json()

      expect(missingResponse.status).toBe(404)
      assertApiContract(simpleErrorResponseSchema, missingBody)
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = previousKey
      }
    }
  })

  it('matches runtime error success and validation-error contracts', async () => {
    const { baseUrl } = await startContractApi()
    const deck = await createDeck(baseUrl)

    const invalidResponse = await fetch(`${baseUrl}/api/runtime-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    })
    const invalid = await invalidResponse.json()

    expect(invalidResponse.status).toBe(400)
    assertApiContract(simpleErrorResponseSchema, invalid)

    const reportResponse = await fetch(`${baseUrl}/api/runtime-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deckId: deck.id,
        message: 'Uncaught TypeError in deck preview',
        runtimeMode: 'reveal',
        slideIndex: 1,
        severity: 'error',
        source: 'deck-preview',
      }),
    })
    const reported = await reportResponse.json()

    expect(reportResponse.status).toBe(201)
    assertApiContract(runtimeErrorResponseSchema, reported)
  })

  it('matches asset upload and list response contracts', async () => {
    const { baseUrl } = await startContractApi()
    const deck = await createDeck(baseUrl)

    const invalidUpload = await fetch(`${baseUrl}/api/decks/${deck.id}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'logo.png' }),
    })
    const invalidUploadBody = await invalidUpload.json()

    expect(invalidUpload.status).toBe(400)
    assertApiContract(simpleErrorResponseSchema, invalidUploadBody)

    const uploadResponse = await fetch(`${baseUrl}/api/decks/${deck.id}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'logo.png',
        mediaType: 'image/png',
        data: pngDataUrl,
      }),
    })
    const uploaded = await uploadResponse.json()

    expect(uploadResponse.status).toBe(201)
    assertApiContract(uploadAssetResponseSchema, uploaded)

    const listResponse = await fetch(`${baseUrl}/api/decks/${deck.id}/assets`)
    const list = await listResponse.json()

    expect(listResponse.status).toBe(200)
    assertApiContract(assetListResponseSchema, list)
  })

  it('matches runtime registry and deck asset proxy contracts', async () => {
    const { baseUrl } = await startContractApi()

    const runtimesResponse = await fetch(`${baseUrl}/api/runtimes`)
    const runtimes = await runtimesResponse.json()

    expect(runtimesResponse.status).toBe(200)
    assertApiContract(runtimeRegistryResponseSchema, runtimes)

    const missingUrlResponse = await fetch(`${baseUrl}/api/deck-assets`)
    const missingUrl = await missingUrlResponse.json()

    expect(missingUrlResponse.status).toBe(400)
    assertApiContract(simpleErrorResponseSchema, missingUrl)

    const blockedResponse = await fetch(
      `${baseUrl}/api/deck-assets?url=${encodeURIComponent('https://example.com/logo.png')}`,
    )
    const blocked = await blockedResponse.json()

    expect(blockedResponse.status).toBe(403)
    assertApiContract(deckAssetProxyBlockedResponseSchema, blocked)
  })
})
