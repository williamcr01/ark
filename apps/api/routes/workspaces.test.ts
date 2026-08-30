import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../app.ts'
import { createDeckStore } from '@ark/storage/stores/deck-store.ts'
import { createWorkspaceStore, type WorkspaceStore } from '@ark/storage/stores/workspace-store.ts'

const sampleHtml = `<!DOCTYPE html><html><head><title>Route Deck</title></head><body><section class="slide"><h1>Hello</h1></section></body></html>`

describe('workspace API routes', () => {
  let root = ''
  let server: Server
  let baseUrl = ''
  let workspaces: WorkspaceStore

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-api-workspaces-'))
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

  async function createDeck() {
    const response = await fetch(`${baseUrl}/api/decks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: sampleHtml }),
    })
    expect(response.status).toBe(201)
    const payload = await response.json()
    return payload.deck as { id: string; filePath: string }
  }

  const saveAs = (deckId: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/decks/${deckId}/save-as`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('rejects Save As onto an existing file with a machine-readable conflict', async () => {
    const deck = await createDeck()
    const targetPath = path.join(root, 'Taken.ark')
    await writeFile(targetPath, 'keep this', 'utf8')

    const response = await saveAs(deck.id, { path: targetPath })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload).toMatchObject({
      error: 'A file already exists at the selected workspace path.',
      code: 'workspace_file_exists',
    })
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('keep this')
  })

  it('rejects Save As onto an already-open workspace', async () => {
    const deck = await createDeck()
    const other = await createDeck()

    const response = await saveAs(deck.id, { path: other.filePath })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload).toMatchObject({ code: 'workspace_already_open' })
  })

  it('syncs the document title and revision when a deck is renamed', async () => {
    const deck = await createDeck()

    const response = await fetch(`${baseUrl}/api/decks/${deck.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Board plan' }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.deck.title).toBe('Board plan')
    expect(payload.deck.documentRevision).toBe(2)
    expect(payload.deck.html).toContain('<title>Board plan</title>')
  })

  it('adopts the file name as the deck title when opening a renamed file', async () => {
    const deck = await createDeck()
    // Unregister the open handle so the file can be re-opened from disk.
    workspaces.close()
    const renamedPath = path.join(root, 'Renamed deck.ark')
    await rename(deck.filePath, renamedPath)

    const response = await fetch(`${baseUrl}/api/workspaces/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: renamedPath }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.deck).toMatchObject({
      id: deck.id,
      title: 'Renamed deck',
      filePath: renamedPath,
    })
  })

  it('renames the managed file when a document title change lands', async () => {
    const deck = await createDeck()

    const response = await fetch(`${baseUrl}/api/decks/${deck.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: sampleHtml.replace('<title>Route Deck</title>', '<title>Board plan</title>'),
        expectedDocumentRevision: 1,
      }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.deck.title).toBe('Board plan')
    expect(path.basename(payload.deck.filePath)).toMatch(/^Board plan( \d+)?\.ark$/)
    await expect(workspaces.get(deck.id)).resolves.toMatchObject({
      path: payload.deck.filePath,
    })
  })

  it('overwrites an existing file when Save As asks for it explicitly', async () => {
    const deck = await createDeck()
    const targetPath = path.join(root, 'Replace me.ark')
    await writeFile(targetPath, 'old content', 'utf8')

    const response = await saveAs(deck.id, { path: targetPath, overwrite: true })

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.deck).toMatchObject({ id: deck.id, filePath: targetPath })
    await expect(workspaces.get(deck.id)).resolves.toMatchObject({ path: targetPath })
  })

  it('overwrites an existing file when Move asks for it explicitly', async () => {
    const deck = await createDeck()
    const targetPath = path.join(root, 'Move over.ark')
    await writeFile(targetPath, 'old content', 'utf8')

    const response = await fetch(`${baseUrl}/api/decks/${deck.id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath, overwrite: true }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.deck).toMatchObject({ id: deck.id, filePath: targetPath })
    await expect(workspaces.get(deck.id)).resolves.toMatchObject({ path: targetPath })
  })

  it('overwrites an existing file when duplicating into an explicit path', async () => {
    const deck = await createDeck()
    const targetPath = path.join(root, 'Shared.ark')
    await writeFile(targetPath, 'old content', 'utf8')

    const response = await fetch(`${baseUrl}/api/decks/${deck.id}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'complete', path: targetPath, overwrite: true }),
    })

    expect(response.status).toBe(201)
    const payload = await response.json()
    expect(payload.deck).toMatchObject({ id: expect.not.stringMatching(deck.id) })
    expect(payload.deck.filePath).toBe(targetPath)
    await expect(workspaces.get(payload.deck.id)).resolves.toMatchObject({ path: targetPath })
  })
})
