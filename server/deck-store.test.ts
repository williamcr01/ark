import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createDeckStore,
  extractDeckTitle,
  isValidDeckId,
} from './deck-store.ts'

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

describe('deck-store helpers', () => {
  it('extracts the deck title from HTML', () => {
    expect(extractDeckTitle(sampleHtml)).toBe('Quarterly Review')
    expect(extractDeckTitle('<html><body></body></html>')).toBe('Untitled deck')
  })

  it('accepts only generated UUID deck ids', () => {
    expect(isValidDeckId('be4b3f4e-d05b-45d1-9da6-89d6df227b54')).toBe(true)
    expect(isValidDeckId('missing-id')).toBe(false)
    expect(isValidDeckId('../escape')).toBe(false)
    expect(isValidDeckId('')).toBe(false)
  })
})

describe('createDeckStore', () => {
  let dataDir = ''

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
      dataDir = ''
    }
  })

  it('creates, reads, updates, and deletes decks', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-decks-'))
    const store = createDeckStore(dataDir)

    const created = await store.createDeck(sampleHtml)
    expect(created.id).toBeTruthy()
    expect(created.title).toBe('Quarterly Review')

    const loaded = await store.getDeck(created.id)
    expect(loaded?.html).toBe(sampleHtml)

    const updatedHtml = sampleHtml.replace('Hello', 'Updated')
    const updated = await store.updateDeck(created.id, updatedHtml)
    expect(updated?.html).toContain('Updated')
    expect(updated?.updatedAt).not.toBe(created.updatedAt)

    const deleted = await store.deleteDeck(created.id)
    expect(deleted).toBe(true)
    expect(await store.getDeck(created.id)).toBeNull()
  })

  it('rejects invalid deck ids before touching the filesystem', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-decks-'))
    const store = createDeckStore(dataDir)

    expect(await store.getDeck('../escape')).toBeNull()
    expect(await store.updateDeck('missing-id', sampleHtml)).toBeNull()
    expect(await store.deleteDeck('../../etc/passwd')).toBe(false)
  })

  it('returns null when updating a missing deck', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-decks-'))
    const store = createDeckStore(dataDir)

    expect(
      await store.updateDeck('be4b3f4e-d05b-45d1-9da6-89d6df227b54', sampleHtml),
    ).toBeNull()
  })
})
