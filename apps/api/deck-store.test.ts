import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDeckStore,
  extractDeckTitle,
  isValidDeckId,
  normalizeDeckTitle,
} from './deck-store.ts'
import { createWorkspaceStore, type WorkspaceStore } from './workspace-store.ts'

const sampleHtml = `<!DOCTYPE html><html><head><title>Quarterly Review</title></head><body><section class="slide"><h1>Hello</h1></section></body></html>`

describe('deck-store helpers', () => {
  it('normalizes titles and validates workspace ids', () => {
    expect(extractDeckTitle(sampleHtml)).toBe('Quarterly Review')
    expect(normalizeDeckTitle(' Board plan ')).toBe('Board plan')
    expect(isValidDeckId('be4b3f4e-d05b-45d1-9da6-89d6df227b54')).toBe(true)
    expect(isValidDeckId('../escape')).toBe(false)
  })
})

describe('createDeckStore', () => {
  let directory = ''
  let workspaces: WorkspaceStore | null = null

  afterEach(async () => {
    vi.useRealTimers()
    workspaces?.close()
    workspaces = null
    if (directory) await rm(directory, { recursive: true, force: true })
    directory = ''
  })

  async function makeStore() {
    directory = await mkdtemp(path.join(os.tmpdir(), 'ark-decks-'))
    workspaces = createWorkspaceStore(directory)
    return createDeckStore(workspaces)
  }

  it('creates, reads, updates, and deletes a single-file workspace', async () => {
    const store = await makeStore()
    const created = await store.createDeck(sampleHtml)
    expect(created).toMatchObject({ title: 'Quarterly Review', documentRevision: 1 })
    expect((await readdir(directory)).filter((name) => name.endsWith('.ark'))).toEqual([
      'Quarterly Review.ark',
    ])

    const updated = await store.updateDeck(created.id, sampleHtml.replace('Hello', 'Updated'), {
      expectedDocumentRevision: created.documentRevision,
    })
    expect(updated).toMatchObject({ documentRevision: 2, html: expect.stringContaining('Updated') })
    expect(await store.deleteDeck(created.id)).toBe(true)
    expect(await store.getDeck(created.id)).toBeNull()
  })

  it('syncs the document title on rename, then follows newer HTML titles', async () => {
    const store = await makeStore()
    const created = await store.createDeck(sampleHtml)
    const renamed = await store.updateDeckMetadata(created.id, { title: 'Board plan' })

    expect(renamed).toMatchObject({ title: 'Board plan', documentRevision: 2 })
    expect(renamed?.html).toContain('<title>Board plan</title>')

    const updated = await store.updateDeck(
      created.id,
      sampleHtml.replace('Quarterly Review', 'HTML title'),
      { expectedDocumentRevision: renamed!.documentRevision },
    )
    expect(updated).toMatchObject({ title: 'HTML title', documentRevision: 3 })
    expect(updated?.html).toContain('<title>HTML title</title>')
  })

  it('lists workspaces by most recently updated first', async () => {
    const store = await makeStore()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const older = await store.createDeck(sampleHtml)
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'))
    const newer = await store.createDeck(sampleHtml.replace('Quarterly Review', 'Roadmap'))
    expect((await store.listDecks()).map((deck) => deck.id)).toEqual([newer.id, older.id])
  })

  it('returns null for missing workspace ids', async () => {
    const store = await makeStore()
    const missing = 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'
    await expect(store.getDeck(missing)).resolves.toBeNull()
    await expect(
      store.updateDeck(missing, sampleHtml, { expectedDocumentRevision: 1 }),
    ).resolves.toBeNull()
    await expect(store.deleteDeck(missing)).resolves.toBe(false)
  })

  it('does not import legacy JSON persistence', async () => {
    const store = await makeStore()
    await writeFile(
      path.join(directory, 'be4b3f4e-d05b-45d1-9da6-89d6df227b54.json'),
      JSON.stringify({ id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54', html: sampleHtml }),
      'utf8',
    )
    await expect(store.listDecks()).resolves.toEqual([])
  })
})
