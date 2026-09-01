/** Bounded `document_history` snapshots inside an `.ark` workspace file. */

import type { DatabaseSync } from 'node:sqlite'

import {
  DEFAULT_DOCUMENT_HISTORY_LIMITS,
  normalizeDocumentHistorySource,
  type DocumentHistoryLimits,
  type DocumentHistorySource,
  type DocumentHistorySummary,
} from '../../records/document-history.ts'

export const DOCUMENT_HISTORY_TABLE = `
  CREATE TABLE document_history (
    revision INTEGER PRIMARY KEY,
    html TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    byte_size INTEGER NOT NULL
  );
`

const CREATE_DOCUMENT_HISTORY_IF_NEEDED = `
  CREATE TABLE IF NOT EXISTS document_history (
    revision INTEGER PRIMARY KEY,
    html TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    byte_size INTEGER NOT NULL
  );
`

export function migrateDocumentHistory(database: DatabaseSync) {
  database.exec(CREATE_DOCUMENT_HISTORY_IF_NEEDED)
  seedDocumentHistoryIfEmpty(database)
}

export function seedDocumentHistoryIfEmpty(database: DatabaseSync) {
  const existing = database.prepare('SELECT COUNT(*) AS count FROM document_history').get() as {
    count: number
  }
  if (existing.count > 0) return

  const row = database
    .prepare(
      `SELECT w.document_revision AS revision, w.updated_at AS created_at, d.html AS html
       FROM workspace w JOIN document d ON d.id = 1`,
    )
    .get() as { revision: number; created_at: string; html: string } | undefined
  if (!row) return

  insertDocumentHistoryRow(database, {
    revision: row.revision,
    html: row.html,
    source: 'create',
    createdAt: row.created_at,
  })
}

export function appendDocumentHistory(
  database: DatabaseSync,
  input: {
    revision: number
    html: string
    source: DocumentHistorySource
    createdAt: string
  },
  limits: DocumentHistoryLimits = DEFAULT_DOCUMENT_HISTORY_LIMITS,
) {
  insertDocumentHistoryRow(database, input)
  evictDocumentHistory(database, limits)
}

function insertDocumentHistoryRow(
  database: DatabaseSync,
  input: {
    revision: number
    html: string
    source: DocumentHistorySource
    createdAt: string
  },
) {
  const byteSize = Buffer.byteLength(input.html, 'utf8')
  database
    .prepare(
      `INSERT INTO document_history (revision, html, source, created_at, byte_size)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.revision,
      input.html,
      normalizeDocumentHistorySource(input.source),
      input.createdAt,
      byteSize,
    )
}

/**
 * Drop oldest snapshots until both caps hold. Always keep the newest row so a
 * single oversized document cannot wipe history entirely.
 */
export function evictDocumentHistory(
  database: DatabaseSync,
  limits: DocumentHistoryLimits = DEFAULT_DOCUMENT_HISTORY_LIMITS,
) {
  for (;;) {
    const stats = database
      .prepare(
        'SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS bytes FROM document_history',
      )
      .get() as { count: number; bytes: number }
    if (stats.count <= 1) return
    if (stats.count <= limits.maxEntries && Number(stats.bytes) <= limits.maxBytes) return
    database
      .prepare(
        `DELETE FROM document_history WHERE revision = (
           SELECT revision FROM document_history ORDER BY revision ASC LIMIT 1
         )`,
      )
      .run()
  }
}

export function listDocumentHistory(database: DatabaseSync): DocumentHistorySummary[] {
  const rows = database
    .prepare(
      `SELECT revision, source, created_at, byte_size
       FROM document_history
       ORDER BY revision ASC`,
    )
    .all() as Array<{
    revision: number
    source: string
    created_at: string
    byte_size: number
  }>

  return rows.map((row) => ({
    revision: row.revision,
    source: normalizeDocumentHistorySource(row.source),
    createdAt: row.created_at,
    byteSize: Number(row.byte_size),
  }))
}

export function readDocumentHistoryHtml(database: DatabaseSync, revision: number) {
  const row = database
    .prepare('SELECT html FROM document_history WHERE revision = ?')
    .get(revision) as { html: string } | undefined
  return row?.html ?? null
}
