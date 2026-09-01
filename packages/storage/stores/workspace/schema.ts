/** The SQLite schema an `.ark` workspace file carries, and how a connection is configured. */

import { createHash } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { DEFAULT_DECK_ORIGIN } from '@ark/deck/document/origin.ts'
import { DOCUMENT_HISTORY_TABLE, migrateDocumentHistory } from './history.ts'

export const ARK_WORKSPACE_FORMAT_VERSION = 1
export const ARK_APPLICATION_ID = 0x41524b31

export const SCHEMA = `
  CREATE TABLE workspace (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    format_version INTEGER NOT NULL,
    document_revision INTEGER NOT NULL DEFAULT 1,
    origin TEXT NOT NULL DEFAULT '${DEFAULT_DECK_ORIGIN}'
  );
  CREATE TABLE document (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    html TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private',
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
  );
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    role TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_by TEXT,
    model TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    UNIQUE(thread_id, sequence)
  );
  CREATE TABLE blobs (
    checksum TEXT PRIMARY KEY,
    media_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    bytes BLOB NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    blob_checksum TEXT NOT NULL REFERENCES blobs(checksum),
    filename TEXT NOT NULL,
    media_type TEXT NOT NULL,
    category TEXT NOT NULL,
    source TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE asset_references (
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    PRIMARY KEY (asset_id, owner_type, owner_id, purpose)
  );
  CREATE TABLE thumbnails (
    slide_hash TEXT NOT NULL,
    renderer_version TEXT NOT NULL,
    manifest_hash TEXT NOT NULL,
    media_type TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    image BLOB NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (slide_hash, renderer_version, manifest_hash)
  );
  ${DOCUMENT_HISTORY_TABLE}
`

export function contentHash(html: string) {
  return createHash('sha256').update(html).digest('hex')
}

export function rollbackJournalPath(workspacePath: string) {
  return `${workspacePath}-journal`
}

/**
 * PERSIST leaves an invalidated rollback journal beside the `.ark` file so
 * sequential commits skip create/delete of that sidecar. Remove it once the
 * connection is closed — the committed database file is complete on its own.
 */
export function removeRollbackJournal(workspacePath: string) {
  try {
    unlinkSync(rollbackJournalPath(workspacePath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }

    console.warn(
      `Could not remove rollback journal at ${rollbackJournalPath(workspacePath)}.`,
      error,
    )
  }
}

export function configure(database: DatabaseSync) {
  // PERSIST keeps an invalidated rollback journal beside the file so sequential
  // editor commits skip create/delete of that sidecar. synchronous=FULL is
  // unchanged; this is not WAL, so copyFile of a closed `.ark` is complete.
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = PERSIST;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 4000;
  `)
}

/**
 * Bring an existing `.ark` file up to the current schema. Additive columns and
 * tables keep the format version stable: older Ark builds select named columns
 * and simply ignore what they do not know about.
 */
export function migrate(database: DatabaseSync) {
  const columns = database.prepare('PRAGMA table_info(workspace)').all() as Array<{ name: string }>

  if (!columns.some((column) => column.name === 'origin')) {
    database.exec(
      `ALTER TABLE workspace ADD COLUMN origin TEXT NOT NULL DEFAULT '${DEFAULT_DECK_ORIGIN}'`,
    )
  }

  migrateDocumentHistory(database)
}
