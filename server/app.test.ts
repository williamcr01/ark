import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createApp } from './app.ts'
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
  }
  error?: string
}

type ApiDeckListResponse = {
  decks?: Array<{
    id: string
    title: string
  }>
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
      body: JSON.stringify({ html: sampleHtml }),
    })
    const created = (await createResponse.json()) as ApiDeckResponse

    expect(createResponse.status).toBe(201)
    expect(created.deck?.title).toBe('Quarterly Review')

    const listResponse = await fetch(`${baseUrl}/api/decks`)
    const list = (await listResponse.json()) as ApiDeckListResponse

    expect(listResponse.status).toBe(200)
    expect(list.decks).toHaveLength(1)
    expect(list.decks?.[0]).toMatchObject({
      id: created.deck?.id,
      title: 'Quarterly Review',
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
      body: JSON.stringify({ html: updatedHtml }),
    })
    const updated = (await updateResponse.json()) as ApiDeckResponse

    expect(updateResponse.status).toBe(200)
    expect(updated.deck?.title).toBe('Board Review')

    const deleteResponse = await fetch(`${baseUrl}/api/decks/${created.deck!.id}`, {
      method: 'DELETE',
    })

    expect(deleteResponse.status).toBe(204)
    expect((await fetch(`${baseUrl}/api/decks/${created.deck!.id}`)).status).toBe(404)
  })
})
