import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDeckStore,
  extractDeckTitle,
  isValidDeckId,
  normalizeDeckTitle,
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

  it('normalizes blank deck titles', () => {
    expect(normalizeDeckTitle(' Board plan ')).toBe('Board plan')
    expect(normalizeDeckTitle('')).toBe('Untitled deck')
    expect(normalizeDeckTitle(null)).toBe('Untitled deck')
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

    vi.useRealTimers()
  })

  it('creates, reads, updates, and deletes decks', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-decks-'))
    const store = createDeckStore(dataDir)

    const created = await store.createDeck(sampleHtml)
    expect(created.id).toBeTruthy()
    expect(created.title).toBe('Quarterly Review')
    expect(created.versionNumber).toBe(1)
    expect(created.activeVersionId).toBeTruthy()

    const loaded = await store.getDeck(created.id)
    expect(loaded?.html).toBe(sampleHtml)

    const updatedHtml = sampleHtml.replace('Hello', 'Updated')
    const updated = await store.updateDeck(created.id, updatedHtml)
    expect(updated?.html).toContain('Updated')
    expect(updated?.title).toBe('Quarterly Review')
    expect(updated?.versionNumber).toBe(2)
    expect(updated?.activeVersionId).not.toBe(created.activeVersionId)
    expect(updated?.updatedAt).not.toBe(created.updatedAt)

    const decks = await store.listDecks()
    expect(decks).toHaveLength(1)
    expect(decks[0]).toMatchObject({
      id: created.id,
      title: 'Quarterly Review',
      versionNumber: 2,
    })
    expect('html' in decks[0]).toBe(false)

    const deleted = await store.deleteDeck(created.id)
    expect(deleted).toBe(true)
    expect(await store.getDeck(created.id)).toBeNull()
  })

  it('creates immutable versions with source metadata', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-decks-'))
    const store = createDeckStore(dataDir)

    const created = await store.createDeck(sampleHtml, {
      source: 'upload',
      summary: 'Initial upload',
    })
    const updated = await store.updateDeck(created.id, sampleHtml.replace('Hello', 'Agent edit'), {
      source: 'agent',
      summary: 'AI edit',
      modelName: 'gpt-4.1',
    })

    const versions = await store.listVersions(created.id)

    expect(versions).toHaveLength(2)
    expect(versions?.[0]).toMatchObject({
      versionNumber: 2,
      source: 'agent',
      summary: 'AI edit',
      isActive: true,
      validationStatus: 'valid',
    })
    expect(versions?.[1]).toMatchObject({
      versionNumber: 1,
      source: 'upload',
      summary: 'Initial upload',
      isActive: false,
    })

    const firstVersion = await store.getVersion(created.id, versions![1].id)
    expect(firstVersion?.html).toBe(sampleHtml)
    expect(firstVersion?.versionNumber).toBe(1)

    const firstVersionMetadata = await store.getVersionMetadata(created.id, versions![1].id)
    expect(firstVersionMetadata?.versionNumber).toBe(1)
    expect('html' in firstVersionMetadata!).toBe(false)

    const rolledBack = await store.rollbackToVersion(created.id, versions![1].id)
    expect(rolledBack?.html).toBe(sampleHtml)
    expect(rolledBack?.versionNumber).toBe(3)

    const afterRollback = await store.listVersions(created.id)
    expect(afterRollback).toHaveLength(3)
    expect(afterRollback?.[0]).toMatchObject({
      versionNumber: 3,
      source: 'rollback',
      isActive: true,
    })
    expect(await store.getVersionMetadata(created.id, afterRollback![0].id)).toMatchObject({
      versionNumber: 3,
      isActive: true,
    })
    expect(updated?.html).toContain('Agent edit')
  })

  it('persists a runtime manifest with each deck version', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-decks-'))
    const store = createDeckStore(dataDir)

    const created = await store.createDeck(sampleHtml)
    const versions = await store.listVersions(created.id)

    expect(versions?.[0]?.runtimeManifest).toMatchObject({
      schemaVersion: 1,
      runtimeMode: 'static',
      previewMode: 'css-only',
      slideCount: 1,
    })
  })

  it('rejects invalid deck ids before touching the filesystem', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-decks-'))
    const store = createDeckStore(dataDir)

    expect(await store.getDeck('../escape')).toBeNull()
    expect(await store.updateDeck('missing-id', sampleHtml)).toBeNull()
    expect(await store.deleteDeck('../../etc/passwd')).toBe(false)
    expect(await store.listDecks()).toEqual([])
    expect(await store.listVersions('missing-id')).toBeNull()
    expect(
      await store.getVersionMetadata('missing-id', 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'),
    ).toBeNull()
    expect(await store.getVersion('missing-id', 'be4b3f4e-d05b-45d1-9da6-89d6df227b54')).toBeNull()
    expect(
      await store.rollbackToVersion('missing-id', 'be4b3f4e-d05b-45d1-9da6-89d6df227b54'),
    ).toBeNull()
  })

  it('returns null when updating a missing deck', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-decks-'))
    const store = createDeckStore(dataDir)

    expect(await store.updateDeck('be4b3f4e-d05b-45d1-9da6-89d6df227b54', sampleHtml)).toBeNull()
  })

  it('lists deck summaries by most recently updated first', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-decks-'))
    const store = createDeckStore(dataDir)

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const older = await store.createDeck(sampleHtml)
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'))
    const newer = await store.createDeck(sampleHtml.replace('Quarterly Review', 'Roadmap'))

    const summaries = await store.listDecks()

    expect(summaries).toEqual([
      {
        id: newer.id,
        title: 'Roadmap',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        activeVersionId: newer.activeVersionId,
        versionNumber: 1,
      },
      {
        id: older.id,
        title: 'Quarterly Review',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        activeVersionId: older.activeVersionId,
        versionNumber: 1,
      },
    ])
  })

  it('updates title metadata without changing HTML or reverting on later saves', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-decks-'))
    const store = createDeckStore(dataDir)

    const created = await store.createDeck(sampleHtml)
    const renamed = await store.updateDeckMetadata(created.id, { title: ' Board plan ' })

    expect(renamed?.title).toBe('Board plan')
    expect(renamed?.html).toBe(sampleHtml)

    const updatedHtmlTitle = sampleHtml.replace('Quarterly Review', 'HTML title')
    const updated = await store.updateDeck(created.id, updatedHtmlTitle)

    expect(updated?.title).toBe('Board plan')
    expect(updated?.html).toContain('<title>HTML title</title>')
  })

  it('returns null when updating metadata for a missing deck', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-decks-'))
    const store = createDeckStore(dataDir)

    expect(
      await store.updateDeckMetadata('be4b3f4e-d05b-45d1-9da6-89d6df227b54', {
        title: 'Missing',
      }),
    ).toBeNull()
  })

  it('migrates legacy single-file decks on read and preserves history on update', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'ark-decks-'))
    const store = createDeckStore(dataDir)
    const legacyDeck = {
      id: 'be4b3f4e-d05b-45d1-9da6-89d6df227b54',
      html: sampleHtml,
      title: 'Quarterly Review',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(dataDir, { recursive: true })
    await writeFile(path.join(dataDir, `${legacyDeck.id}.json`), JSON.stringify(legacyDeck), 'utf8')

    const loaded = await store.getDeck(legacyDeck.id)
    expect(loaded?.html).toBe(sampleHtml)

    const updated = await store.updateDeck(legacyDeck.id, sampleHtml.replace('Hello', 'Migrated'))
    expect(updated?.versionNumber).toBe(2)

    const versions = await store.listVersions(legacyDeck.id)
    expect(versions).toHaveLength(2)
  })
})
