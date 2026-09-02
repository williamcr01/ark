import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  assertApiContract,
  apiErrorPayloadSchema,
  appendChatMessageResponseSchema,
  createDeckResponseSchema,
  deckChatResponseSchema,
  deckListResponseSchema,
  deckPatchResponseSchema,
  deckResponseSchema,
  generationJobResponseSchema,
  healthResponseSchema,
  modelsResponseSchema,
  previewSessionResponseSchema,
  simpleErrorResponseSchema,
} from '@ark/contracts'
import { clearModelCatalogCache } from '@ark/ai/models.ts'
import {
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck/document/metadata.ts'
import { createDeckStore } from '@ark/storage/stores/deck-store.ts'
import { createApp } from './app.ts'

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
  let server: Server
  let baseUrl = ''

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-api-decks-'))
    const app = createApp({ deckStore: createDeckStore(dataDir) })
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('creates, lists, reads, updates, and deletes decks', async () => {
    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml }),
    })
    const created = await createResponse.json()

    expect(createResponse.status).toBe(201)
    assertApiContract(createDeckResponseSchema, created)
    expect(created.deck?.title).toBe('Quarterly Review')
    expect(created.deck?.documentRevision).toBe(1)

    const listResponse = await fetch(`${baseUrl}/api/decks`)
    const list = await listResponse.json()

    expect(listResponse.status).toBe(200)
    assertApiContract(deckListResponseSchema, list)
    const listed = list.decks?.find((deck: { id: string }) => deck.id === created.deck?.id)
    expect(listed).toMatchObject({
      id: created.deck?.id,
      title: 'Quarterly Review',
      documentRevision: 1,
    })
    expect(listed && 'html' in listed).toBe(false)

    const fetchResponse = await fetch(`${baseUrl}/api/decks/${created.deck!.id}`)
    const fetched = await fetchResponse.json()

    expect(fetchResponse.status).toBe(200)
    assertApiContract(deckResponseSchema, fetched)
    expect(fetched.deck?.html).toBe(sampleHtml)

    const updatedHtml = sampleHtml.replace('Quarterly Review', 'Board Review')
    const updateResponse = await fetch(`${baseUrl}/api/decks/${created.deck!.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: updatedHtml, expectedDocumentRevision: 1 }),
    })
    const updated = await updateResponse.json()

    expect(updateResponse.status).toBe(200)
    assertApiContract(createDeckResponseSchema, updated)
    expect(updated.deck?.title).toBe('Board Review')
    expect(updated.deck?.documentRevision).toBe(2)

    const deleteResponse = await fetch(`${baseUrl}/api/decks/${created.deck!.id}`, {
      method: 'DELETE',
    })

    expect(deleteResponse.status).toBe(204)
    expect((await fetch(`${baseUrl}/api/decks/${created.deck!.id}`)).status).toBe(404)
  })

  it('applies structured slide patches to the workspace document', async () => {
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
      body: JSON.stringify({ html: multiSlideHtml }),
    })
    const created = await createResponse.json()
    assertApiContract(createDeckResponseSchema, created)
    const deckId = created.deck.id

    const patchResponse = await fetch(`${baseUrl}/api/decks/${deckId}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedDocumentRevision: 1,
        operations: [{ op: 'update_slide_title', slideIndex: 1, title: 'Updated second slide' }],
      }),
    })
    const patched = await patchResponse.json()

    expect(patchResponse.status).toBe(200)
    assertApiContract(deckPatchResponseSchema, patched)
    expect(patched.deck?.documentRevision).toBe(2)
    expect(patched.patch).toMatchObject({
      appliedCount: 1,
      changedSlideIndexes: [1],
      summary: expect.stringContaining('Updated title'),
    })
    expect(patched.deck?.html).toContain('Updated second slide')
  })

  it('moves one managed element on a 500-element slide through the patch route', async () => {
    const elements = Array.from({ length: 500 }, (_, index) => {
      const left = 10 + (index % 20) * 40
      const top = 10 + Math.floor(index / 20) * 30
      return `<div data-ark-id="ark-el-${index}" data-ark-managed="true" style="position:absolute;left:${left}px;top:${top}px;width:80px;height:40px">Item ${index}</div>`
    }).join('\n')
    const html = `<!DOCTYPE html><html><head><title>Dense</title></head><body><section class="slide">${elements}</section></body></html>`

    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html }),
    })
    const created = await createResponse.json()
    assertApiContract(createDeckResponseSchema, created)
    const deckId = created.deck.id as string

    const patchResponse = await fetch(`${baseUrl}/api/decks/${deckId}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedDocumentRevision: 1,
        operations: [{ op: 'move_element', elementId: 'ark-el-0', slideIndex: 0, x: 0.5, y: 0.5 }],
      }),
    })
    const patched = await patchResponse.json()

    expect(patchResponse.status).toBe(200)
    assertApiContract(deckPatchResponseSchema, patched)
    expect(patched.patch).toMatchObject({
      appliedCount: 1,
      changedElementIds: ['ark-el-0'],
      changedSlideIndexes: [0],
    })
    expect(patched.deck?.html).toContain(`left: ${Math.round(0.5 * ARK_SLIDE_REFERENCE_WIDTH)}px`)
    expect(patched.deck?.html).toContain(`top: ${Math.round(0.5 * ARK_SLIDE_REFERENCE_HEIGHT)}px`)
    expect(patched.deck?.html).toContain('data-ark-id="ark-el-499"')
    expect(patched.deck?.html.match(/data-ark-id="ark-el-\d+"/g)).toHaveLength(500)
    expect(patched.deck?.html).toContain('Item 1')
  })

  it('rejects locked, unsafe, and duplicate-id editor patches on the route', async () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Classify</title></head>
<body>
  <section class="slide">
    <p data-ark-id="ark-el-locked" data-ark-locked="true">Do not edit</p>
    <h1 data-ark-id="ark-el-title">First</h1>
  </section>
  <section class="slide">
    <h2 data-ark-id="ark-el-title">Second</h2>
  </section>
</body>
</html>`

    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html }),
    })
    const created = await createResponse.json()
    assertApiContract(createDeckResponseSchema, created)
    const deckId = created.deck.id as string

    const lockedResponse = await fetch(`${baseUrl}/api/decks/${deckId}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedDocumentRevision: 1,
        operations: [
          { op: 'move_element', elementId: 'ark-el-locked', slideIndex: 0, x: 0.1, y: 0.1 },
        ],
      }),
    })
    const locked = await lockedResponse.json()
    expect(lockedResponse.status).toBe(400)
    expect(locked).toMatchObject({ error: expect.stringContaining('locked') })

    const unsafeResponse = await fetch(`${baseUrl}/api/decks/${deckId}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedDocumentRevision: 1,
        operations: [
          { op: 'insert_element', slideIndex: 0, html: '<div><script>alert(1)</script></div>' },
        ],
      }),
    })
    const unsafe = await unsafeResponse.json()
    expect(unsafeResponse.status).toBe(400)
    expect(unsafe).toMatchObject({ error: expect.stringContaining('unsafe <script>') })

    const duplicateResponse = await fetch(`${baseUrl}/api/decks/${deckId}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedDocumentRevision: 1,
        operations: [{ op: 'replace_text', elementId: 'ark-el-title', text: 'Ambiguous' }],
      }),
    })
    const duplicate = await duplicateResponse.json()
    expect(duplicateResponse.status).toBe(400)
    expect(duplicate).toMatchObject({ error: expect.stringContaining('ambiguous') })
  })

  it('returns a stable conflict response for stale writes', async () => {
    const createdResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml }),
    })
    const created = await createdResponse.json()
    const id = created.deck.id as string
    const first = await fetch(`${baseUrl}/api/decks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: sampleHtml.replace('Hello', 'Fresh'),
        expectedDocumentRevision: 1,
      }),
    })
    expect(first.status).toBe(200)

    const stale = await fetch(`${baseUrl}/api/decks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: sampleHtml.replace('Hello', 'Stale'),
        expectedDocumentRevision: 1,
      }),
    })
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toMatchObject({
      code: 'document_conflict',
      currentDocumentRevision: 2,
    })
  })

  it('returns consistent validation errors for invalid create payloads', async () => {
    const response = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '   ' }),
    })
    const payload = await response.json()

    expect(response.status).toBe(400)
    assertApiContract(simpleErrorResponseSchema, payload)
    expect(payload.error).toContain('HTML')

    const removedMetadataResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml, source: 'manual' }),
    })
    expect(removedMetadataResponse.status).toBe(400)
  })
})

describe('deck chat API routes', () => {
  let root = ''
  let server: Server
  let baseUrl = ''

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-api-chat-'))
    const app = createApp({ deckStore: createDeckStore(path.join(root, 'workspaces')) })
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    await rm(root, { recursive: true, force: true })
  })

  it('returns empty chat for a new deck and persists appended messages', async () => {
    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml }),
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
    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml }),
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
  let server: Server
  let baseUrl = ''

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-api-contracts-'))
    const app = createApp({ deckStore: createDeckStore(dataDir) })
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('returns health and models payloads that match shared contracts', async () => {
    const previousKeys = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    }
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    delete process.env.OPENROUTER_API_KEY
    clearModelCatalogCache()

    try {
      const healthResponse = await fetch(`${baseUrl}/api/health`)
      const health = await healthResponse.json()

      expect(healthResponse.status).toBe(200)
      assertApiContract(healthResponseSchema, health)
      expect(health.providers).toMatchObject({
        openai: { configured: false },
        anthropic: { configured: false },
        google: { configured: false },
        openrouter: { configured: false },
      })

      const modelsResponse = await fetch(`${baseUrl}/api/models`)
      const models = await modelsResponse.json()

      expect(modelsResponse.status).toBe(200)
      assertApiContract(modelsResponseSchema, models)
      expect(models).toMatchObject({ models: [], defaultModel: null, warnings: [] })
      expect(models.models.every((model: { available: boolean }) => model.available)).toBe(true)
      expect(
        models.models.every(
          (model: { unavailableReason?: string }) => model.unavailableReason == null,
        ),
      ).toBe(true)
    } finally {
      for (const [key, value] of Object.entries(previousKeys)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      clearModelCatalogCache()
    }
  })

  it('returns preview session payloads that match shared contracts', async () => {
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
    // Preview-sessions uses a 12mb JSON limit aligned with deck save; a ~13mb body must be rejected.
    const oversizedHtml = `<html><body>${'x'.repeat(13 * 1024 * 1024)}</body></html>`

    const response = await fetch(`${baseUrl}/api/preview-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: oversizedHtml }),
    })

    expect(response.status).toBe(413)
  })

  it('returns generation job error payloads that match shared contracts', async () => {
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
