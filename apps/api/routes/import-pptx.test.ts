import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { apiErrorPayloadSchema, assertApiContract, createDeckResponseSchema } from '@ark/contracts'
import { PPTX_ENCRYPTED_MESSAGE, PPTX_LEGACY_MESSAGE } from '@ark/deck-import'
import { buildEncryptedPptx, buildLegacyPpt, buildPptx } from '@ark/deck-import/pptx-fixtures.ts'
import { createApp } from '../app.ts'
import { createDeckStore } from '@ark/storage/stores/deck-store.ts'
import { createWorkspaceStore, type WorkspaceStore } from '@ark/storage/stores/workspace-store.ts'

describe('POST /api/decks/import-pptx', () => {
  let root = ''
  let server: Server
  let baseUrl = ''
  let workspaces: WorkspaceStore

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-api-import-pptx-'))
    workspaces = createWorkspaceStore(root)
    const app = createApp({ deckStore: createDeckStore(workspaces), workspaceStore: workspaces })
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    workspaces.close()
    await rm(root, { recursive: true, force: true })
  })

  it('creates a new authored workspace from a PPTX', async () => {
    const pptx = await buildPptx({
      title: 'Imported Board',
      slides: [
        {
          notes: 'Speaker beat.',
          shapes: [{ text: 'Hello from PowerPoint' }],
          picture: true,
        },
      ],
    })

    const existing = await workspaces.listRecent()
    const response = await fetch(`${baseUrl}/api/decks/import-pptx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'board.pptx',
        bytes: Buffer.from(pptx).toString('base64'),
      }),
    })

    expect(response.status).toBe(201)
    const payload = await response.json()
    assertApiContract(createDeckResponseSchema, payload)
    expect(payload.deck.origin).toBe('authored')
    expect(payload.deck.title).toBe('Imported Board')
    expect(payload.deck.html).toContain('Hello from PowerPoint')
    expect(payload.deck.html).toContain('Speaker beat.')
    expect(payload.deck.html).toContain('data-ark-managed="true"')
    expect(payload.deck.html).toContain('ark-asset:')
    expect(payload.deck.html).not.toMatch(/src="data:image\/png;base64,/)
    expect(existing.every((row) => row.id !== payload.deck.id)).toBe(true)
    expect(payload.deck.filePath).toMatch(/\.ark$/)
  })

  it('imports from a filesystem path without touching an already-open deck', async () => {
    const pptx = await buildPptx({
      title: 'From Disk',
      slides: [{ shapes: [{ text: 'Disk import' }] }],
    })
    const filePath = path.join(root, 'from-disk.pptx')
    await writeFile(filePath, pptx)

    const first = await fetch(`${baseUrl}/api/decks/import-pptx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    })
    const second = await fetch(`${baseUrl}/api/decks/import-pptx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    })
    const firstDeck = (await first.json()).deck as { id: string }
    const secondDeck = (await second.json()).deck as { id: string }
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(firstDeck.id).not.toBe(secondDeck.id)
  })

  it('rejects legacy .ppt files', async () => {
    const response = await fetch(`${baseUrl}/api/decks/import-pptx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'old.ppt',
        bytes: Buffer.from(buildLegacyPpt()).toString('base64'),
      }),
    })
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload).toMatchObject({ error: PPTX_LEGACY_MESSAGE, code: 'pptx_legacy' })
  })

  it('rejects password-protected files', async () => {
    const response = await fetch(`${baseUrl}/api/decks/import-pptx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'secret.pptx',
        bytes: Buffer.from(await buildEncryptedPptx()).toString('base64'),
      }),
    })
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload).toMatchObject({ error: PPTX_ENCRYPTED_MESSAGE, code: 'pptx_encrypted' })
    assertApiContract(apiErrorPayloadSchema, payload)
  })
})
