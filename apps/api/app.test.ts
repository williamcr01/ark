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
  createDeckResponseSchema,
  deckChatResponseSchema,
  deckListResponseSchema,
  deckPatchResponseSchema,
  deckResponseSchema,
  deckRollbackResponseSchema,
  deckVersionListResponseSchema,
  deckVersionResponseSchema,
  generationJobResponseSchema,
  healthResponseSchema,
  modelsResponseSchema,
  previewSessionResponseSchema,
  simpleErrorResponseSchema,
} from '@ark/contracts'
import { createApp } from './app.ts'
import { createChatStore } from './chat-store.ts'
import { createDeckStore } from './deck-store.ts'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Quarterly Review</title>
</head>
<body>
  <section class="slide"><h1>Hello</h1></section>
</body>
</html>`

describe('deck API routes', () => {
  let dataDir = ''
  let server: Server | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()))
      })
      server = null
    }

    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
      dataDir = ''
    }
  })

  async function startApi() {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-api-decks-'))
    const app = createApp({ deckStore: createDeckStore(dataDir) })

    server = app.listen(0)
    await new Promise<void>((resolve) => server?.once('listening', resolve))

    const address = server.address() as AddressInfo

    return `http://127.0.0.1:${address.port}`
  }

  it('creates, lists, reads, updates, and deletes decks', async () => {
    const baseUrl = await startApi()

    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml, source: 'upload' }),
    })
    const created = await createResponse.json()

    expect(createResponse.status).toBe(201)
    assertApiContract(createDeckResponseSchema, created)
    expect(created.deck?.title).toBe('Quarterly Review')
    expect(created.deck?.versionNumber).toBe(1)

    const listResponse = await fetch(`${baseUrl}/api/decks`)
    const list = await listResponse.json()

    expect(listResponse.status).toBe(200)
    assertApiContract(deckListResponseSchema, list)
    expect(list.decks).toHaveLength(1)
    expect(list.decks?.[0]).toMatchObject({
      id: created.deck?.id,
      title: 'Quarterly Review',
      versionNumber: 1,
    })
    expect('html' in list.decks![0]).toBe(false)

    const fetchResponse = await fetch(`${baseUrl}/api/decks/${created.deck!.id}`)
    const fetched = await fetchResponse.json()

    expect(fetchResponse.status).toBe(200)
    assertApiContract(deckResponseSchema, fetched)
    expect(fetched.deck?.html).toBe(sampleHtml)

    const updatedHtml = sampleHtml.replace('Quarterly Review', 'Board Review')
    const updateResponse = await fetch(`${baseUrl}/api/decks/${created.deck!.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: updatedHtml, source: 'manual', summary: 'Manual edit' }),
    })
    const updated = await updateResponse.json()

    expect(updateResponse.status).toBe(200)
    assertApiContract(createDeckResponseSchema, updated)
    expect(updated.deck?.title).toBe('Board Review')
    expect(updated.deck?.versionNumber).toBe(2)

    const deleteResponse = await fetch(`${baseUrl}/api/decks/${created.deck!.id}`, {
      method: 'DELETE',
    })

    expect(deleteResponse.status).toBe(204)
    expect((await fetch(`${baseUrl}/api/decks/${created.deck!.id}`)).status).toBe(404)
  })

  it('applies structured slide patches and persists a new version', async () => {
    const baseUrl = await startApi()
    const multiSlideHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Patch Deck</title>
</head>
<body>
  <section class="slide"><h1>One</h1></section>
  <section class="slide"><h1>Two</h1></section>
</body>
</html>`

    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: multiSlideHtml, source: 'upload' }),
    })
    const created = await createResponse.json()
    assertApiContract(createDeckResponseSchema, created)
    const deckId = created.deck.id

    const patchResponse = await fetch(`${baseUrl}/api/decks/${deckId}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{ op: 'update_slide_title', slideIndex: 1, title: 'Updated second slide' }],
        source: 'manual',
      }),
    })
    const patched = await patchResponse.json()

    expect(patchResponse.status).toBe(200)
    assertApiContract(deckPatchResponseSchema, patched)
    expect(patched.deck?.versionNumber).toBe(2)
    expect(patched.patch).toMatchObject({
      appliedCount: 1,
      changedSlideIndexes: [1],
      summary: expect.stringContaining('Updated title'),
    })
    expect(patched.deck?.html).toContain('Updated second slide')

    const versionsResponse = await fetch(`${baseUrl}/api/decks/${deckId}/versions`)
    const versionsPayload = await versionsResponse.json()

    assertApiContract(deckVersionListResponseSchema, versionsPayload)
    expect(versionsPayload.versions?.[0]).toMatchObject({
      source: 'manual',
      provenance: {
        operations: ['update_slide_title'],
        slideIndexes: [1],
        runtimeManifestHash: expect.any(String),
      },
      diff: {
        kind: 'structural',
      },
    })
  })

  it('persists manual provenance from PUT and ignores forged agent provenance', async () => {
    const baseUrl = await startApi()

    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml, source: 'upload' }),
    })
    const created = await createResponse.json()
    const deckId = created.deck.id

    const manualHtml = sampleHtml.replace('Hello', 'Manual edit')
    const manualResponse = await fetch(`${baseUrl}/api/decks/${deckId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: manualHtml,
        source: 'manual',
        summary: 'Undo: replace text',
        provenance: {
          operations: ['undo'],
          slideIndexes: [0],
          elementIds: ['ark-el-1'],
        },
      }),
    })

    expect(manualResponse.status).toBe(200)

    const manualVersions = await (await fetch(`${baseUrl}/api/decks/${deckId}/versions`)).json()
    expect(manualVersions.versions?.[0]).toMatchObject({
      source: 'manual',
      summary: 'Undo: replace text',
      provenance: {
        operations: ['undo'],
        slideIndexes: [0],
        elementIds: ['ark-el-1'],
        runtimeManifestHash: expect.any(String),
      },
    })
    expect(manualVersions.versions?.[0].provenance?.jobId).toBeUndefined()
    expect(manualVersions.versions?.[0].provenance?.toolCalls).toBeUndefined()

    const leakedHtml = '<section class="slide"><h1>Secret deck HTML</h1></section>'
    const forgedManualHtml = manualHtml.replace('Manual edit', 'Forged manual')
    await fetch(`${baseUrl}/api/decks/${deckId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: forgedManualHtml,
        source: 'manual',
        summary: 'Forged manual provenance',
        provenance: {
          operations: ['undo'],
          jobId: 'forged-job-id',
          toolCalls: [{ toolName: 'patch_deck', summary: `Applied ${leakedHtml}` }],
          restoredVersionId: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
        },
      }),
    })

    const forgedManualVersions = await (
      await fetch(`${baseUrl}/api/decks/${deckId}/versions`)
    ).json()
    expect(forgedManualVersions.versions?.[0].provenance).toMatchObject({
      operations: ['undo'],
    })
    expect(forgedManualVersions.versions?.[0].provenance?.jobId).toBeUndefined()
    expect(forgedManualVersions.versions?.[0].provenance?.toolCalls).toBeUndefined()
    expect(JSON.stringify(forgedManualVersions.versions?.[0].provenance)).not.toContain('<section')

    const forgedAgentHtml = manualHtml.replace('Manual edit', 'Forged agent')
    await fetch(`${baseUrl}/api/decks/${deckId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: forgedAgentHtml,
        source: 'agent',
        modelProvider: 'openai',
        modelName: 'gpt-forged',
        diff: { kind: 'coarse', htmlBytesBefore: 1, htmlBytesAfter: 2 },
        provenance: {
          jobId: 'forged-job-id',
          operations: ['undo'],
        },
      }),
    })

    const forgedAgentVersions = await (
      await fetch(`${baseUrl}/api/decks/${deckId}/versions`)
    ).json()
    // Spoofed agent/rollback sources coerce to manual; only manual provenance fields stick.
    expect(forgedAgentVersions.versions?.[0]).toMatchObject({
      source: 'manual',
      provenance: {
        operations: ['undo'],
        runtimeManifestHash: expect.any(String),
      },
    })
    expect(forgedAgentVersions.versions?.[0].modelProvider ?? null).toBeNull()
    expect(forgedAgentVersions.versions?.[0].modelName ?? null).toBeNull()
    expect(forgedAgentVersions.versions?.[0].diff?.kind).toBe('structural')
    expect(forgedAgentVersions.versions?.[0].diff?.htmlBytesBefore).toBeUndefined()
    expect(forgedAgentVersions.versions?.[0].provenance?.jobId).toBeUndefined()
    expect(forgedAgentVersions.versions?.[0].provenance?.toolCalls).toBeUndefined()
  })

  it('lists versions, fetches one version, and rolls back without losing history', async () => {
    const baseUrl = await startApi()

    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml, source: 'upload' }),
    })
    const created = await createResponse.json()
    assertApiContract(createDeckResponseSchema, created)
    const deckId = created.deck.id

    const updatedHtml = sampleHtml.replace('Hello', 'Updated')
    await fetch(`${baseUrl}/api/decks/${deckId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: updatedHtml, source: 'manual' }),
    })

    const versionsResponse = await fetch(`${baseUrl}/api/decks/${deckId}/versions`)
    const versionsPayload = await versionsResponse.json()

    expect(versionsResponse.status).toBe(200)
    assertApiContract(deckVersionListResponseSchema, versionsPayload)
    expect(versionsPayload.versions).toHaveLength(2)
    expect(versionsPayload.versions?.[0]).toMatchObject({
      versionNumber: 2,
      source: 'manual',
      isActive: true,
    })
    expect(versionsPayload.versions?.[1]).toMatchObject({
      versionNumber: 1,
      source: 'upload',
      isActive: false,
    })
    expect('html' in versionsPayload.versions![0]).toBe(false)

    const firstVersionId = versionsPayload.versions![1].id
    const versionResponse = await fetch(`${baseUrl}/api/decks/${deckId}/versions/${firstVersionId}`)
    const versionPayload = await versionResponse.json()

    expect(versionResponse.status).toBe(200)
    assertApiContract(deckVersionResponseSchema, versionPayload)
    expect(versionPayload.version?.html).toBe(sampleHtml)

    const rollbackResponse = await fetch(`${baseUrl}/api/decks/${deckId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId: firstVersionId }),
    })
    const rollbackPayload = await rollbackResponse.json()

    expect(rollbackResponse.status).toBe(200)
    assertApiContract(deckRollbackResponseSchema, rollbackPayload)
    expect(rollbackPayload.deck?.html).toBe(sampleHtml)
    expect(rollbackPayload.deck?.versionNumber).toBe(3)

    const versionsAfterRollback = await (
      await fetch(`${baseUrl}/api/decks/${deckId}/versions`)
    ).json()

    assertApiContract(deckVersionListResponseSchema, versionsAfterRollback)

    expect(versionsAfterRollback.versions).toHaveLength(3)
    expect(versionsAfterRollback.versions?.[0]).toMatchObject({
      versionNumber: 3,
      source: 'rollback',
      isActive: true,
    })
  })

  it('returns consistent validation errors for invalid create payloads', async () => {
    const baseUrl = await startApi()

    const response = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '   ' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(400)
    assertApiContract(simpleErrorResponseSchema, payload)
    expect(payload.error).toContain('HTML')
  })

  it('rejects invalid version and rollback requests', async () => {
    const baseUrl = await startApi()

    expect((await fetch(`${baseUrl}/api/decks/not-a-uuid/versions`)).status).toBe(400)
    expect(
      (await fetch(`${baseUrl}/api/decks/not-a-uuid/versions/be4b3f4e-d05b-45d1-9da6-89d6df227b54`))
        .status,
    ).toBe(400)
    expect(
      (
        await fetch(`${baseUrl}/api/decks/not-a-uuid/rollback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versionId: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54' }),
        })
      ).status,
    ).toBe(400)
  })
})

describe('deck chat API routes', () => {
  let deckDir = ''
  let chatDir = ''
  let server: Server | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()))
      })
      server = null
    }

    for (const dir of [deckDir, chatDir]) {
      if (dir) {
        await rm(dir, { recursive: true, force: true })
      }
    }

    deckDir = ''
    chatDir = ''
  })

  async function startApi() {
    deckDir = await mkdtemp(path.join(os.tmpdir(), 'ark-api-decks-'))
    chatDir = await mkdtemp(path.join(os.tmpdir(), 'ark-api-chat-'))
    const app = createApp({
      deckStore: createDeckStore(deckDir),
      chatStore: createChatStore(chatDir),
    })

    server = app.listen(0)
    await new Promise<void>((resolve) => server?.once('listening', resolve))

    const address = server.address() as AddressInfo

    return `http://127.0.0.1:${address.port}`
  }

  it('returns empty chat for a new deck and persists appended messages', async () => {
    const baseUrl = await startApi()

    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml, source: 'upload' }),
    })
    const created = await createResponse.json()
    assertApiContract(createDeckResponseSchema, created)
    const deckId = created.deck.id

    const initialChatResponse = await fetch(`${baseUrl}/api/decks/${deckId}/chat`)
    const initialChat = await initialChatResponse.json()

    expect(initialChatResponse.status).toBe(200)
    assertApiContract(deckChatResponseSchema, initialChat)
    expect(initialChat.thread).toBeNull()
    expect(initialChat.messages).toEqual([])

    const appendResponse = await fetch(`${baseUrl}/api/decks/${deckId}/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '00000000-0000-4000-8000-000000000101',
        role: 'user',
        content: 'Make this deck darker',
      }),
    })
    const appended = await appendResponse.json()

    expect(appendResponse.status).toBe(201)
    assertApiContract(appendChatMessageResponseSchema, appended)
    expect(appended.message).toMatchObject({
      id: '00000000-0000-4000-8000-000000000101',
      role: 'user',
      content: 'Make this deck darker',
    })

    const chatResponse = await fetch(`${baseUrl}/api/decks/${deckId}/chat`)
    const chat = await chatResponse.json()

    assertApiContract(deckChatResponseSchema, chat)
    expect(chat.thread?.deckId).toBe(deckId)
    expect(chat.messages).toHaveLength(1)
    expect(chat.messages[0]).toMatchObject({
      role: 'user',
      content: 'Make this deck darker',
    })
  })

  it('stores assistant tool activity without full deck html', async () => {
    const baseUrl = await startApi()

    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml, source: 'upload' }),
    })
    const created = await createResponse.json()
    assertApiContract(createDeckResponseSchema, created)
    const deckId = created.deck.id

    await fetch(`${baseUrl}/api/decks/${deckId}/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'assistant',
        content: 'Updated the deck.',
        parts: [{ type: 'tool-result', toolName: 'edit_deck', summary: 'Patched title slide' }],
        generationStatus: 'succeeded',
      }),
    })

    const chatResponse = await fetch(`${baseUrl}/api/decks/${deckId}/chat`)
    const chat = await chatResponse.json()

    assertApiContract(deckChatResponseSchema, chat)
    expect(chat.messages[0]?.content).toBe('Updated the deck.')
    expect(chat.messages[0]?.parts?.[0]).toMatchObject({
      type: 'tool-result',
      summary: 'Patched title slide',
    })
    expect(JSON.stringify(chat.messages[0])).not.toContain('<!DOCTYPE html>')
  })

  it('returns 404 when appending chat to a missing deck', async () => {
    const baseUrl = await startApi()

    const response = await fetch(
      `${baseUrl}/api/decks/00000000-0000-4000-8000-000000000099/chat/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: 'hello' }),
      },
    )

    expect(response.status).toBe(404)
  })
})

describe('shared API route contracts', () => {
  let dataDir = ''
  let server: Server | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()))
      })
      server = null
    }

    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
      dataDir = ''
    }
  })

  async function startApi() {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-api-contracts-'))
    const app = createApp({ deckStore: createDeckStore(dataDir) })

    server = app.listen(0)
    await new Promise<void>((resolve) => server?.once('listening', resolve))

    const address = server.address() as AddressInfo

    return `http://127.0.0.1:${address.port}`
  }

  it('returns health and models payloads that match shared contracts', async () => {
    const baseUrl = await startApi()

    const healthResponse = await fetch(`${baseUrl}/api/health`)
    const health = await healthResponse.json()

    expect(healthResponse.status).toBe(200)
    assertApiContract(healthResponseSchema, health)

    const modelsResponse = await fetch(`${baseUrl}/api/models`)
    const models = await modelsResponse.json()

    expect(modelsResponse.status).toBe(200)
    assertApiContract(modelsResponseSchema, models)
  })

  it('returns preview session payloads that match shared contracts', async () => {
    const baseUrl = await startApi()

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
  })

  it('rejects oversized preview session bodies before the global JSON limit', async () => {
    const baseUrl = await startApi()
    // Preview-sessions uses a 2mb JSON limit; a ~3mb body must be rejected.
    const oversizedHtml = `<html><body>${'x'.repeat(3 * 1024 * 1024)}</body></html>`

    const response = await fetch(`${baseUrl}/api/preview-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: oversizedHtml }),
    })

    expect(response.status).toBe(413)
  })

  it('returns generation job error payloads that match shared contracts', async () => {
    const baseUrl = await startApi()

    const missingKeyResponse = await fetch(`${baseUrl}/api/generation-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Build a deck' }],
      }),
    })
    const missingKey = await missingKeyResponse.json()

    if (missingKeyResponse.status === 503) {
      assertApiContract(apiErrorPayloadSchema, missingKey)
      return
    }

    expect(missingKeyResponse.status).toBe(202)
    assertApiContract(generationJobResponseSchema, missingKey)
  })
})
