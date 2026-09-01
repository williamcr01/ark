/**
 * HTTP API contract drift prevention (#135).
 *
 * Exercises representative success and validation-error responses against the
 * Zod schemas in `packages/contracts/`. When a route changes its wire shape, update
 * the contract schema first, then adjust these tests — see packages/contracts/README.md.
 */
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  deckConflictErrorResponseSchema,
  deckListResponseSchema,
  deckPatchResponseSchema,
  deckResponseSchema,
  documentHistoryListResponseSchema,
  restoreDocumentHistoryResponseSchema,
  deckThumbnailsResponseSchema,
  deckValidationErrorResponseSchema,
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
import { type RunDeckAgentResult } from '@ark/agent/agent.ts'
import { createApp } from './app.ts'
import { createAssetStore } from '@ark/storage/stores/asset-store.ts'
import { createChatStore } from '@ark/storage/stores/chat-store.ts'
import { createDeckStore } from '@ark/storage/stores/deck-store.ts'
import { createGenerationJobStore } from '@ark/storage/stores/generation-job-store.ts'
import {
  createPreviewSessionStore,
  type PreviewSessionStore,
} from '@ark/storage/stores/preview-sessions.ts'
import type { ThumbnailService } from './thumbnails/service.ts'
import { createGenerationJobRunner } from '@ark/agent/job-runner.ts'
import { createWorkspaceStore, type WorkspaceStore } from '@ark/storage/stores/workspace-store.ts'

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

const disabledThumbnailService: ThumbnailService = {
  isAvailable: () => false,
  getStatus: async () => ({ status: 'disabled', slides: [] }),
  enqueue: async () => ({ status: 'disabled', slides: [] }),
  readPng: async () => null,
  enqueueForDocument: async () => undefined,
  close: async () => undefined,
}

function unsetDeckAssetAllowlist() {
  const previous = process.env.ARK_DECK_ASSET_ALLOWLIST
  delete process.env.ARK_DECK_ASSET_ALLOWLIST

  return () => {
    if (previous === undefined) {
      delete process.env.ARK_DECK_ASSET_ALLOWLIST
      return
    }

    process.env.ARK_DECK_ASSET_ALLOWLIST = previous
  }
}

type ContractApi = {
  baseUrl: string
}

describe('HTTP API contract drift prevention', () => {
  let root = ''
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
    if (root) {
      await rm(root, { recursive: true, force: true })
      root = ''
    }
  })

  async function startContractApi(
    options: { previewSessionStore?: PreviewSessionStore } = {},
  ): Promise<ContractApi> {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-api-contract-'))

    workspaces = createWorkspaceStore(path.join(root, 'workspaces'))
    const deckStore = createDeckStore(workspaces)
    const chatStore = createChatStore(workspaces)
    const jobStore = createGenerationJobStore()
    const assetStore = createAssetStore(workspaces)

    const generationJobRunner = createGenerationJobRunner({
      deckStore,
      jobStore,
      chatStore,
      assetStore,
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
      workspaceStore: workspaces,
      generationJobStore: jobStore,
      generationJobRunner,
      thumbnailService: disabledThumbnailService,
      previewSessionStore: options.previewSessionStore,
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
      body: JSON.stringify({ html: sampleHtml }),
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
      body: JSON.stringify({ html: externalUrlHtml }),
    })
    const validationErrorBody = await validationErrorResponse.json()

    expect(validationErrorResponse.status).toBe(400)
    assertApiContract(deckValidationErrorResponseSchema, validationErrorBody)

    const missingResponse = await fetch(`${baseUrl}/api/decks/00000000-0000-4000-8000-000000000099`)
    const missingBody = await missingResponse.json()

    expect(missingResponse.status).toBe(404)
    assertApiContract(simpleErrorResponseSchema, missingBody)
  })

  it('matches the editor patch response contract without measurement fields', async () => {
    const { baseUrl } = await startContractApi()
    const deck = await createDeck(baseUrl)

    const patchResponse = await fetch(`${baseUrl}/api/decks/${deck.id}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedDocumentRevision: 1,
        operations: [{ op: 'update_slide_title', slideIndex: 0, title: 'Contract' }],
      }),
    })
    const patched = await patchResponse.json()

    expect(patchResponse.status).toBe(200)
    assertApiContract(deckPatchResponseSchema, patched)
    expect(
      Object.keys(patched)
        .filter((key) => key !== 'requestId')
        .sort(),
    ).toEqual(['deck', 'patch', 'validation'])
    expect(patched.deck.html).toContain('Contract')
    expect(patched.patch.appliedCount).toBe(1)
  })

  it('matches document history list and restore contracts', async () => {
    const { baseUrl } = await startContractApi()
    const deck = await createDeck(baseUrl)

    const updatedHtml = sampleHtml.replace('Hello', 'Edited')
    const updateResponse = await fetch(`${baseUrl}/api/decks/${deck.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: updatedHtml, expectedDocumentRevision: 1 }),
    })
    expect(updateResponse.status).toBe(200)

    const listResponse = await fetch(`${baseUrl}/api/decks/${deck.id}/history`)
    const listBody = await listResponse.json()
    expect(listResponse.status).toBe(200)
    assertApiContract(documentHistoryListResponseSchema, listBody)

    const conflictResponse = await fetch(`${baseUrl}/api/decks/${deck.id}/history/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 1, expectedDocumentRevision: 1 }),
    })
    const conflictBody = await conflictResponse.json()
    expect(conflictResponse.status).toBe(409)
    assertApiContract(deckConflictErrorResponseSchema, conflictBody)

    const restoreResponse = await fetch(`${baseUrl}/api/decks/${deck.id}/history/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 1, expectedDocumentRevision: 2 }),
    })
    const restoreBody = await restoreResponse.json()
    expect(restoreResponse.status).toBe(200)
    assertApiContract(restoreDocumentHistoryResponseSchema, restoreBody)
  })

  it('returns 404 when a recent workspace file was deleted outside Ark', async () => {
    const { baseUrl } = await startContractApi()
    const deck = await createDeck(baseUrl)
    workspaces?.close()
    await rm(deck.filePath)

    const response = await fetch(`${baseUrl}/api/decks/${deck.id}`)
    const body = await response.json()

    expect(response.status).toBe(404)
    assertApiContract(simpleErrorResponseSchema, body)
  })

  it('returns a conflict for workspace actions that would overwrite a file', async () => {
    const { baseUrl } = await startContractApi()
    const deck = await createDeck(baseUrl)
    const occupiedPath = path.join(root, 'occupied.ark')
    await writeFile(occupiedPath, 'keep me', 'utf8')

    for (const action of ['save-as', 'move', 'duplicate']) {
      const response = await fetch(`${baseUrl}/api/decks/${deck.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: occupiedPath,
          ...(action === 'duplicate' ? { mode: 'presentation' } : {}),
        }),
      })
      expect(response.status).toBe(409)
      assertApiContract(simpleErrorResponseSchema, await response.json())
    }
    await expect(readFile(occupiedPath, 'utf8')).resolves.toBe('keep me')
  })

  it('reports when asset inlining exceeds preview memory capacity', async () => {
    const { baseUrl } = await startContractApi({
      previewSessionStore: createPreviewSessionStore({ maxTotalHtmlBytes: 500 }),
    })
    const deck = await createDeck(baseUrl)
    const uploadResponse = await fetch(`${baseUrl}/api/decks/${deck.id}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'large.png',
        mediaType: 'image/png',
        data: `data:image/png;base64,${Buffer.concat([PNG_BYTES, Buffer.alloc(1_024)]).toString('base64')}`,
      }),
    })
    const uploaded = await uploadResponse.json()
    expect(uploadResponse.status).toBe(201)
    const html = sampleHtml.replace('</body>', `<img src="ark-asset:${uploaded.asset.id}"></body>`)

    const response = await fetch(`${baseUrl}/api/preview-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deckId: deck.id, html }),
    })
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      error: 'The deck and its embedded assets exceed the preview memory limit.',
    })
  })

  it('matches the disabled thumbnail response contract', async () => {
    const { baseUrl } = await startContractApi()
    const deck = await createDeck(baseUrl)

    const response = await fetch(
      `${baseUrl}/api/decks/${deck.id}/thumbnails?documentRevision=${deck.documentRevision}`,
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    assertApiContract(deckThumbnailsResponseSchema, payload)
    expect(payload.status).toBe('disabled')
    expect(payload.slides).toEqual([])
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

  it('matches preview session payload-too-large contract', async () => {
    const { baseUrl } = await startContractApi()
    const oversizedHtml = `<html><body>${'x'.repeat(13 * 1024 * 1024)}</body></html>`

    const response = await fetch(`${baseUrl}/api/preview-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: oversizedHtml }),
    })

    expect(response.status).toBe(413)
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
    const restoreDeckAssetAllowlist = unsetDeckAssetAllowlist()

    try {
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
    } finally {
      restoreDeckAssetAllowlist()
    }
  })
})
