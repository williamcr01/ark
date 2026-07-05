import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

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

type ApiDeckResponse = {
  deck?: {
    id: string
    html: string
    title: string
    versionNumber?: number
    activeVersionId?: string
  }
  error?: string
}

type ApiDeckListResponse = {
  decks?: Array<{
    id: string
    title: string
    versionNumber?: number
  }>
  error?: string
}

type ApiVersionListResponse = {
  versions?: Array<{
    id: string
    versionNumber: number
    source: string
    isActive: boolean
  }>
  error?: string
}

type ApiVersionResponse = {
  version?: {
    id: string
    versionNumber: number
    html: string
  }
  error?: string
}

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
    const created = (await createResponse.json()) as ApiDeckResponse

    expect(createResponse.status).toBe(201)
    expect(created.deck?.title).toBe('Quarterly Review')
    expect(created.deck?.versionNumber).toBe(1)

    const listResponse = await fetch(`${baseUrl}/api/decks`)
    const list = (await listResponse.json()) as ApiDeckListResponse

    expect(listResponse.status).toBe(200)
    expect(list.decks).toHaveLength(1)
    expect(list.decks?.[0]).toMatchObject({
      id: created.deck?.id,
      title: 'Quarterly Review',
      versionNumber: 1,
    })
    expect('html' in list.decks![0]).toBe(false)

    const fetchResponse = await fetch(`${baseUrl}/api/decks/${created.deck!.id}`)
    const fetched = (await fetchResponse.json()) as ApiDeckResponse

    expect(fetchResponse.status).toBe(200)
    expect(fetched.deck?.html).toBe(sampleHtml)

    const updatedHtml = sampleHtml.replace('Quarterly Review', 'Board Review')
    const updateResponse = await fetch(`${baseUrl}/api/decks/${created.deck!.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: updatedHtml, source: 'agent', summary: 'AI edit' }),
    })
    const updated = (await updateResponse.json()) as ApiDeckResponse

    expect(updateResponse.status).toBe(200)
    expect(updated.deck?.title).toBe('Board Review')
    expect(updated.deck?.versionNumber).toBe(2)

    const deleteResponse = await fetch(`${baseUrl}/api/decks/${created.deck!.id}`, {
      method: 'DELETE',
    })

    expect(deleteResponse.status).toBe(204)
    expect((await fetch(`${baseUrl}/api/decks/${created.deck!.id}`)).status).toBe(404)
  })

  it('lists versions, fetches one version, and rolls back without losing history', async () => {
    const baseUrl = await startApi()

    const createResponse = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml, source: 'upload' }),
    })
    const created = (await createResponse.json()) as ApiDeckResponse
    const deckId = created.deck!.id

    const updatedHtml = sampleHtml.replace('Hello', 'Updated')
    await fetch(`${baseUrl}/api/decks/${deckId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: updatedHtml, source: 'agent' }),
    })

    const versionsResponse = await fetch(`${baseUrl}/api/decks/${deckId}/versions`)
    const versionsPayload = (await versionsResponse.json()) as ApiVersionListResponse

    expect(versionsResponse.status).toBe(200)
    expect(versionsPayload.versions).toHaveLength(2)
    expect(versionsPayload.versions?.[0]).toMatchObject({
      versionNumber: 2,
      source: 'agent',
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
    const versionPayload = (await versionResponse.json()) as ApiVersionResponse

    expect(versionResponse.status).toBe(200)
    expect(versionPayload.version?.html).toBe(sampleHtml)

    const rollbackResponse = await fetch(`${baseUrl}/api/decks/${deckId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId: firstVersionId }),
    })
    const rollbackPayload = (await rollbackResponse.json()) as ApiDeckResponse

    expect(rollbackResponse.status).toBe(200)
    expect(rollbackPayload.deck?.html).toBe(sampleHtml)
    expect(rollbackPayload.deck?.versionNumber).toBe(3)

    const versionsAfterRollback = (await (
      await fetch(`${baseUrl}/api/decks/${deckId}/versions`)
    ).json()) as ApiVersionListResponse

    expect(versionsAfterRollback.versions).toHaveLength(3)
    expect(versionsAfterRollback.versions?.[0]).toMatchObject({
      versionNumber: 3,
      source: 'rollback',
      isActive: true,
    })
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
    const created = (await createResponse.json()) as ApiDeckResponse
    const deckId = created.deck!.id

    const initialChatResponse = await fetch(`${baseUrl}/api/decks/${deckId}/chat`)
    const initialChat = (await initialChatResponse.json()) as {
      thread: unknown
      messages: unknown[]
      hasMore: boolean
    }

    expect(initialChatResponse.status).toBe(200)
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
    const appended = (await appendResponse.json()) as {
      message?: { id: string; content: string; role: string }
    }

    expect(appendResponse.status).toBe(201)
    expect(appended.message).toMatchObject({
      id: '00000000-0000-4000-8000-000000000101',
      role: 'user',
      content: 'Make this deck darker',
    })

    const chatResponse = await fetch(`${baseUrl}/api/decks/${deckId}/chat`)
    const chat = (await chatResponse.json()) as {
      thread: { deckId: string } | null
      messages: Array<{ content: string; role: string }>
    }

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
    const created = (await createResponse.json()) as ApiDeckResponse
    const deckId = created.deck!.id

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
    const chat = (await chatResponse.json()) as {
      messages: Array<{ content: string; parts?: Array<{ summary: string }> }>
    }

    expect(chat.messages[0]?.content).toBe('Updated the deck.')
    expect(chat.messages[0]?.parts?.[0]?.summary).toBe('Patched title slide')
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
