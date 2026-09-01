import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_DECK_ORIGIN } from '@ark/deck/document/origin.ts'

import { garbageCollectUnreferencedAssets } from './assets.ts'
import {
  DOCUMENT_HISTORY_TABLE,
  appendDocumentHistory,
  evictDocumentHistory,
  listDocumentHistory,
  migrateDocumentHistory,
  readDocumentHistoryHtml,
} from './history.ts'
import { ARK_WORKSPACE_FORMAT_VERSION, SCHEMA, configure, contentHash } from './schema.ts'

const html = (label: string) =>
  `<!DOCTYPE html><html><head><title>${label}</title></head><body><section class="slide"><h1>${label}</h1></section></body></html>`

function memoryWorkspace(documentHtml = html('Seed')) {
  const database = new DatabaseSync(':memory:')
  configure(database)
  database.exec(SCHEMA)
  const now = '2026-09-01T00:00:00.000Z'
  database
    .prepare(
      `INSERT INTO workspace
       (id, title, created_at, updated_at, format_version, document_revision, origin)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(
      '00000000-0000-4000-8000-000000000001',
      'Seed',
      now,
      now,
      ARK_WORKSPACE_FORMAT_VERSION,
      DEFAULT_DECK_ORIGIN,
    )
  database
    .prepare('INSERT INTO document (id, html, content_hash, updated_at) VALUES (1, ?, ?, ?)')
    .run(documentHtml, contentHash(documentHtml), now)
  return database
}

describe('document_history helpers', () => {
  let database: DatabaseSync | null = null

  afterEach(() => {
    database?.close()
    database = null
  })

  it('seeds the current document when the table is empty', () => {
    database = memoryWorkspace()
    database.exec('DROP TABLE document_history')
    migrateDocumentHistory(database)

    expect(listDocumentHistory(database)).toEqual([
      expect.objectContaining({ revision: 1, source: 'create' }),
    ])
    expect(readDocumentHistoryHtml(database, 1)).toContain('Seed')
  })

  it('evicts oldest rows past the entry cap and keeps the newest', () => {
    database = memoryWorkspace()
    appendDocumentHistory(
      database,
      { revision: 1, html: html('Seed'), source: 'create', createdAt: '2026-09-01T00:00:00.000Z' },
      { maxEntries: 2, maxBytes: 1024 * 1024 },
    )
    appendDocumentHistory(
      database,
      { revision: 2, html: html('Two'), source: 'editor', createdAt: '2026-09-01T00:00:01.000Z' },
      { maxEntries: 2, maxBytes: 1024 * 1024 },
    )
    appendDocumentHistory(
      database,
      { revision: 3, html: html('Three'), source: 'agent', createdAt: '2026-09-01T00:00:02.000Z' },
      { maxEntries: 2, maxBytes: 1024 * 1024 },
    )

    expect(listDocumentHistory(database).map((row) => row.revision)).toEqual([2, 3])
    expect(readDocumentHistoryHtml(database, 1)).toBeNull()
  })

  it('evicts oldest rows past the byte cap and never deletes the newest snapshot', () => {
    database = memoryWorkspace()
    const limits = { maxEntries: 50, maxBytes: 80 }
    appendDocumentHistory(
      database,
      {
        revision: 1,
        html: 'a'.repeat(50),
        source: 'create',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      limits,
    )
    appendDocumentHistory(
      database,
      {
        revision: 2,
        html: 'b'.repeat(50),
        source: 'editor',
        createdAt: '2026-09-01T00:00:01.000Z',
      },
      limits,
    )
    expect(listDocumentHistory(database).map((row) => row.revision)).toEqual([2])

    appendDocumentHistory(
      database,
      {
        revision: 3,
        html: 'c'.repeat(200),
        source: 'editor',
        createdAt: '2026-09-01T00:00:02.000Z',
      },
      limits,
    )
    expect(listDocumentHistory(database)).toEqual([
      expect.objectContaining({ revision: 3, byteSize: 200 }),
    ])
  })

  it('is a no-op when history is already under the caps', () => {
    database = memoryWorkspace()
    appendDocumentHistory(database, {
      revision: 1,
      html: html('Seed'),
      source: 'create',
      createdAt: '2026-09-01T00:00:00.000Z',
    })
    evictDocumentHistory(database, { maxEntries: 50, maxBytes: 8 * 1024 * 1024 })
    expect(listDocumentHistory(database)).toHaveLength(1)
  })

  it('shares one CREATE TABLE with SCHEMA', () => {
    expect(SCHEMA).toContain(DOCUMENT_HISTORY_TABLE)
    expect(SCHEMA.match(/CREATE TABLE document_history/g)).toEqual([
      'CREATE TABLE document_history',
    ])
  })

  it('pins history ark-asset ids and drops them when the snapshot is evicted', () => {
    database = memoryWorkspace()
    const assetId = '11111111-1111-4111-8111-111111111111'
    const checksum = createHash('sha256').update('png').digest('hex')
    database
      .prepare(
        `INSERT INTO blobs (checksum, media_type, byte_size, bytes, created_at)
         VALUES (?, 'image/png', 3, ?, '2020-01-01T00:00:00.000Z')`,
      )
      .run(checksum, Buffer.from('png'))
    database
      .prepare(
        `INSERT INTO assets
         (id, blob_checksum, filename, media_type, category, source, created_at)
         VALUES (?, ?, 'a.png', 'image/png', 'image', 'upload', '2020-01-01T00:00:00.000Z')`,
      )
      .run(assetId, checksum)

    const limits = { maxEntries: 1, maxBytes: 1024 * 1024 }
    appendDocumentHistory(
      database,
      {
        revision: 1,
        html: `<img src="ark-asset:${assetId}">`,
        source: 'create',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      limits,
    )
    expect(
      database
        .prepare('SELECT owner_type, owner_id, purpose FROM asset_references WHERE asset_id = ?')
        .all(assetId),
    ).toEqual([{ owner_type: 'history', owner_id: '1', purpose: 'snapshot' }])

    appendDocumentHistory(
      database,
      {
        revision: 2,
        html: html('Later'),
        source: 'editor',
        createdAt: '2026-09-01T00:00:01.000Z',
      },
      limits,
    )
    expect(database.prepare('SELECT COUNT(*) AS count FROM asset_references').get()).toEqual({
      count: 0,
    })

    garbageCollectUnreferencedAssets(database)
    expect(database.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 0 })
  })

  it('re-pins existing history rows on migrate without requiring the asset to still be in the live document', () => {
    database = memoryWorkspace()
    const assetId = '22222222-2222-4222-8222-222222222222'
    const checksum = createHash('sha256').update('old').digest('hex')
    database
      .prepare(
        `INSERT INTO blobs (checksum, media_type, byte_size, bytes, created_at)
         VALUES (?, 'image/png', 3, ?, '2020-01-01T00:00:00.000Z')`,
      )
      .run(checksum, Buffer.from('old'))
    database
      .prepare(
        `INSERT INTO assets
         (id, blob_checksum, filename, media_type, category, source, created_at)
         VALUES (?, ?, 'old.png', 'image/png', 'image', 'upload', '2020-01-01T00:00:00.000Z')`,
      )
      .run(assetId, checksum)
    database
      .prepare(
        `INSERT INTO document_history (revision, html, source, created_at, byte_size)
         VALUES (1, ?, 'create', '2026-09-01T00:00:00.000Z', 32)`,
      )
      .run(`<img src="ark-asset:${assetId}">`)

    migrateDocumentHistory(database)
    expect(
      database
        .prepare('SELECT owner_type, owner_id FROM asset_references WHERE asset_id = ?')
        .get(assetId),
    ).toEqual({ owner_type: 'history', owner_id: '1' })
  })
})
