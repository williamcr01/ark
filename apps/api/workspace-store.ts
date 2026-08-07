import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'

import { extractDeckTitle, isValidDeckId, normalizeDeckTitle } from '@ark/contracts'
import {
  DEFAULT_DECK_ORIGIN,
  deckOriginAfterWrite,
  normalizeDeckOrigin,
  type DeckOrigin,
} from '@ark/deck-core/deck-origin.ts'
import { resolveArkDataDir } from './data-dir.ts'
import type { EmbeddedAsset } from './embedded-assets.ts'

export const ARK_WORKSPACE_FORMAT_VERSION = 1
export const ARK_APPLICATION_ID = 0x41524b31
const ASSET_GC_GRACE_MS = 60_000

const defaultWorkspaceDir = () =>
  process.env.ARK_WORKSPACES_DIR?.trim() || resolveArkDataDir('workspaces')
const recentWorkspacesPath = () =>
  process.env.ARK_RECENT_WORKSPACES_PATH?.trim() || resolveArkDataDir('recent-workspaces.json')

type RecentWorkspace = {
  id: string
  path: string
  title: string
  updatedAt: string
  lastOpened: string
  cover?: string
}

const SCHEMA = `
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
`

export type WorkspaceRow = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  documentRevision: number
  origin: DeckOrigin
  html: string
  path: string
}

export class WorkspaceDocumentConflictError extends Error {
  readonly code = 'document_conflict'
  readonly currentDocumentRevision: number

  constructor(currentDocumentRevision: number) {
    super('The deck changed. Re-read it and retry against the latest revision.')
    this.name = 'WorkspaceDocumentConflictError'
    this.currentDocumentRevision = currentDocumentRevision
  }
}

type WorkspaceMetadata = Omit<WorkspaceRow, 'html'>

/**
 * What can be read from a closed file without migrating it: `inspectWorkspaceFile`
 * opens read-only, so it must not touch columns an older file may still lack.
 */
type WorkspaceIdentity = Omit<WorkspaceMetadata, 'origin'>

type OpenWorkspace = {
  id: string
  path: string
  database: DatabaseSync
}

function contentHash(html: string) {
  return createHash('sha256').update(html).digest('hex')
}

function configure(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 4000;
  `)
}

/**
 * Bring an existing `.ark` file up to the current schema. Additive columns with
 * defaults keep the format version stable: older Ark builds select named columns
 * and simply ignore what they do not know about.
 */
function migrate(database: DatabaseSync) {
  const columns = database.prepare('PRAGMA table_info(workspace)').all() as Array<{ name: string }>

  if (!columns.some((column) => column.name === 'origin')) {
    database.exec(
      `ALTER TABLE workspace ADD COLUMN origin TEXT NOT NULL DEFAULT '${DEFAULT_DECK_ORIGIN}'`,
    )
  }
}

function syncDocumentAssetReferences(database: DatabaseSync, html: string) {
  const ids = [
    ...new Set(
      [...html.matchAll(/ark-asset:([0-9a-f-]{36})/gi)].map((match) => match[1]!.toLowerCase()),
    ),
  ]
  for (const id of ids) {
    if (!database.prepare('SELECT 1 FROM assets WHERE id = ?').get(id)) {
      throw new Error(`Unknown Ark asset: ${id}`)
    }
  }
  database.prepare("DELETE FROM asset_references WHERE owner_type = 'document'").run()
  const insert = database.prepare(
    `INSERT INTO asset_references
     (asset_id, owner_type, owner_id, purpose) VALUES (?, 'document', '1', 'embedded')`,
  )
  for (const id of ids) insert.run(id)
}

function garbageCollectUnreferencedAssets(database: DatabaseSync) {
  const cutoff = new Date(Date.now() - ASSET_GC_GRACE_MS).toISOString()
  database
    .prepare(
      `
    DELETE FROM assets
    WHERE NOT EXISTS (
      SELECT 1 FROM asset_references WHERE asset_references.asset_id = assets.id
    ) AND created_at <= ?
  `,
    )
    .run(cutoff)
  database.exec(`
    DELETE FROM blobs
    WHERE NOT EXISTS (
      SELECT 1 FROM assets WHERE assets.blob_checksum = blobs.checksum
    );
  `)
}

function insertEmbeddedAssets(database: DatabaseSync, assets: readonly EmbeddedAsset[]) {
  const now = new Date().toISOString()
  for (const asset of assets) {
    const checksum = createHash('sha256').update(asset.bytes).digest('hex')
    database
      .prepare(
        `INSERT OR IGNORE INTO blobs
         (checksum, media_type, byte_size, bytes, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(checksum, asset.mediaType, asset.bytes.byteLength, asset.bytes, now)
    database
      .prepare(
        `INSERT INTO assets
         (id, blob_checksum, filename, media_type, category, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(asset.id, checksum, asset.filename, asset.mediaType, asset.category, asset.source, now)
  }
}

function readWorkspace(open: OpenWorkspace): WorkspaceRow {
  const row = open.database
    .prepare(
      `SELECT w.id, w.title, w.created_at, w.updated_at, w.document_revision, w.origin, d.html
       FROM workspace w JOIN document d ON d.id = 1`,
    )
    .get() as
    | {
        id: string
        title: string
        created_at: string
        updated_at: string
        document_revision: number
        origin: string
        html: string
      }
    | undefined

  if (!row) throw new Error('Invalid Ark workspace: workspace document is missing.')
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documentRevision: row.document_revision,
    origin: normalizeDeckOrigin(row.origin),
    html: row.html,
    path: open.path,
  }
}

function readWorkspaceMetadata(open: OpenWorkspace): WorkspaceMetadata {
  const row = open.database
    .prepare('SELECT id, title, created_at, updated_at, document_revision, origin FROM workspace')
    .get() as
    | {
        id: string
        title: string
        created_at: string
        updated_at: string
        document_revision: number
        origin: string
      }
    | undefined

  if (!row) throw new Error('Invalid Ark workspace: metadata is missing.')
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documentRevision: row.document_revision,
    origin: normalizeDeckOrigin(row.origin),
    path: open.path,
  }
}

function inspectWorkspaceFile(filePath: string): WorkspaceIdentity {
  const resolved = path.resolve(filePath)
  let database: DatabaseSync
  try {
    database = new DatabaseSync(resolved, { readOnly: true })
  } catch (error) {
    throw new Error('Could not open Ark workspace.', { cause: error })
  }

  try {
    const applicationId = database.prepare('PRAGMA application_id').get() as {
      application_id: number
    }
    const userVersion = database.prepare('PRAGMA user_version').get() as {
      user_version: number
    }
    const row = database
      .prepare(
        `SELECT id, title, created_at, updated_at, document_revision, format_version
         FROM workspace`,
      )
      .get() as
      | {
          id: string
          title: string
          created_at: string
          updated_at: string
          document_revision: number
          format_version: number
        }
      | undefined

    if (
      applicationId.application_id !== ARK_APPLICATION_ID ||
      userVersion.user_version !== ARK_WORKSPACE_FORMAT_VERSION ||
      row?.format_version !== ARK_WORKSPACE_FORMAT_VERSION ||
      !row ||
      !isValidDeckId(row.id)
    ) {
      throw new Error('Unsupported or invalid Ark workspace.')
    }

    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      documentRevision: row.document_revision,
      path: resolved,
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Unsupported or invalid Ark workspace.') {
      throw error
    }
    throw new Error('Unsupported or invalid Ark workspace.', { cause: error })
  } finally {
    database.close()
  }
}

function safeFileStem(title: string) {
  return (
    normalizeDeckTitle(title)
      // Intentionally strips control characters from filesystem names.
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/[. ]+$/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 120) || 'Untitled Presentation'
  )
}

export class WorkspaceStore {
  private defaultDir: string
  private readonly recentFilePath: string
  private readonly byId = new Map<string, OpenWorkspace>()
  private readonly byPath = new Map<string, OpenWorkspace>()
  private indexed = false
  private readonly recent = new Map<string, RecentWorkspace>()
  private recentLoaded = false

  constructor(rootDir?: string) {
    this.defaultDir = path.resolve(rootDir ?? defaultWorkspaceDir())
    this.recentFilePath = rootDir
      ? path.join(this.defaultDir, 'recent-workspaces.json')
      : recentWorkspacesPath()
  }

  get rootDir() {
    return this.defaultDir
  }

  setDefaultDirectory(directory: string) {
    this.defaultDir = path.resolve(directory)
    this.indexed = false
  }

  private openFile(filePath: string) {
    const resolved = path.resolve(filePath)
    const existing = this.byPath.get(resolved)
    if (existing) return existing

    const metadata = inspectWorkspaceFile(resolved)
    const identityOwner = this.byId.get(metadata.id)
    if (identityOwner) {
      throw new Error(
        `This workspace copy has the same identity as the already-open file at "${identityOwner.path}". Use Duplicate in Ark to create an independent copy.`,
      )
    }

    const writableDatabase = new DatabaseSync(resolved)
    configure(writableDatabase)
    migrate(writableDatabase)
    const open = { id: metadata.id, path: resolved, database: writableDatabase }
    this.byId.set(open.id, open)
    this.byPath.set(open.path, open)
    return open
  }

  private async index() {
    if (this.indexed) return
    if (!this.recentLoaded) {
      try {
        const entries = JSON.parse(await readFile(this.recentFilePath, 'utf8')) as RecentWorkspace[]
        for (const entry of entries) {
          if (isValidDeckId(entry.id) && typeof entry.path === 'string')
            this.recent.set(entry.id, entry)
        }
      } catch {
        // The recent index is disposable.
      }
      this.recentLoaded = true
    }
    await mkdir(this.rootDir, { recursive: true })
    const entries = await readdir(this.rootDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.ark')) continue
      try {
        const metadata = inspectWorkspaceFile(path.join(this.rootDir, entry.name))
        if (!this.recent.has(metadata.id)) {
          this.recent.set(metadata.id, {
            id: metadata.id,
            path: metadata.path,
            title: metadata.title,
            updatedAt: metadata.updatedAt,
            lastOpened: metadata.updatedAt,
          })
        }
      } catch {
        // Invalid files stay untouched and do not appear in Ark.
      }
    }
    this.indexed = true
    await this.persistRecent()
  }

  private openById(id: string) {
    const existing = this.byId.get(id)
    if (existing) return existing
    const recent = this.recent.get(id)
    if (!recent) return null
    try {
      const metadata = inspectWorkspaceFile(recent.path)
      if (metadata.id !== id) return null
      return this.openFile(recent.path)
    } catch {
      return null
    }
  }

  private async persistRecent() {
    const filePath = this.recentFilePath
    await mkdir(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify([...this.recent.values()], null, 2), 'utf8')
    await rename(temporary, filePath)
  }

  private async touchRecent(workspace: WorkspaceRow) {
    const cover = this.recent.get(workspace.id)?.cover
    this.recent.set(workspace.id, {
      id: workspace.id,
      path: workspace.path,
      title: workspace.title,
      updatedAt: workspace.updatedAt,
      lastOpened: new Date().toISOString(),
      ...(cover ? { cover } : {}),
    })
    await this.persistRecent()
  }

  private async uniquePath(title: string, directory: string = this.rootDir) {
    const stem = safeFileStem(title)
    for (let suffix = 1; ; suffix += 1) {
      const candidate = path.join(directory, `${stem}${suffix === 1 ? '' : ` ${suffix}`}.ark`)
      try {
        await access(candidate)
      } catch {
        return candidate
      }
    }
  }

  async create(
    html: string,
    requestedId?: string,
    targetPath?: string,
    embeddedAssets: readonly EmbeddedAsset[] = [],
    origin: DeckOrigin = DEFAULT_DECK_ORIGIN,
  ) {
    await this.index()
    const id = requestedId ?? randomUUID()
    if (!isValidDeckId(id) || this.byId.has(id)) throw new Error('Workspace id is invalid or used.')

    const title = extractDeckTitle(html)
    const filePath = path.resolve(targetPath ?? (await this.uniquePath(title)))
    await mkdir(path.dirname(filePath), { recursive: true })
    try {
      await access(filePath)
      throw new Error('A file already exists at the selected workspace path.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const database = new DatabaseSync(filePath)

    try {
      configure(database)
      database.exec(
        `PRAGMA application_id = ${ARK_APPLICATION_ID}; PRAGMA user_version = ${ARK_WORKSPACE_FORMAT_VERSION};`,
      )
      database.exec(SCHEMA)
      const now = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        insertEmbeddedAssets(database, embeddedAssets)
        database
          .prepare(
            `INSERT INTO workspace
             (id, title, created_at, updated_at, format_version, document_revision, origin)
             VALUES (?, ?, ?, ?, ?, 1, ?)`,
          )
          .run(id, title, now, now, ARK_WORKSPACE_FORMAT_VERSION, origin)
        database
          .prepare('INSERT INTO document (id, html, content_hash, updated_at) VALUES (1, ?, ?, ?)')
          .run(html, contentHash(html), now)
        syncDocumentAssetReferences(database, html)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    } catch (error) {
      database.close()
      await unlink(filePath).catch(() => undefined)
      throw error
    }

    const open = { id, path: filePath, database }
    this.byId.set(id, open)
    this.byPath.set(filePath, open)
    const workspace = readWorkspace(open)
    await this.touchRecent(workspace)
    return workspace
  }

  async open(filePath: string) {
    await this.index()
    const workspace = readWorkspace(this.openFile(filePath))
    await this.touchRecent(workspace)
    return workspace
  }

  async get(id: string) {
    await this.index()
    const open = this.openById(id)
    return open ? readWorkspace(open) : null
  }

  async listRecent() {
    await this.index()
    const summaries = await Promise.all(
      [...this.recent.values()].map(async (recent) => {
        const open = this.byId.get(recent.id)
        if (open) {
          return { ...readWorkspaceMetadata(open), missing: false as const, cover: recent.cover }
        }
        let missing = false
        try {
          await access(recent.path)
        } catch {
          missing = true
        }
        return {
          id: recent.id,
          title: recent.title,
          createdAt: recent.updatedAt,
          updatedAt: recent.updatedAt,
          documentRevision: null,
          path: recent.path,
          missing,
          cover: recent.cover,
        }
      }),
    )
    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async removeRecent(id: string) {
    await this.index()
    const removed = this.recent.delete(id)
    if (removed) await this.persistRecent()
    return removed
  }

  async locate(id: string, filePath: string) {
    await this.index()
    const metadata = inspectWorkspaceFile(filePath)
    if (metadata.id !== id) {
      throw new Error('Selected workspace has a different identity.')
    }
    const workspace = readWorkspace(this.openFile(filePath))
    await this.touchRecent(workspace)
    return workspace
  }

  async updateDocument(
    id: string,
    html: string,
    expectedDocumentRevision: number,
    embeddedAssets: readonly EmbeddedAsset[] = [],
  ) {
    await this.index()
    const open = this.openById(id)
    if (!open) return null
    const current = readWorkspace(open)
    const nextExtractedTitle = extractDeckTitle(html)
    const title =
      current.title === extractDeckTitle(current.html) ? nextExtractedTitle : current.title
    const now = new Date().toISOString()
    // Re-saving byte-identical HTML (autosave on an untouched starter deck) is
    // not authoring, so it must not retire the blank origin.
    const origin = html === current.html ? current.origin : deckOriginAfterWrite(current.origin)

    open.database.exec('BEGIN IMMEDIATE')
    try {
      const revisionUpdate = open.database
        .prepare(
          `UPDATE workspace
           SET title = ?, updated_at = ?, document_revision = document_revision + 1, origin = ?
           WHERE document_revision = ?`,
        )
        .run(title, now, origin, expectedDocumentRevision)
      if (revisionUpdate.changes === 0) {
        const latest = open.database.prepare('SELECT document_revision FROM workspace').get() as {
          document_revision: number
        }
        throw new WorkspaceDocumentConflictError(latest.document_revision)
      }
      insertEmbeddedAssets(open.database, embeddedAssets)
      syncDocumentAssetReferences(open.database, html)
      garbageCollectUnreferencedAssets(open.database)
      open.database
        .prepare('UPDATE document SET html = ?, content_hash = ?, updated_at = ? WHERE id = 1')
        .run(html, contentHash(html), now)
      open.database.exec('COMMIT')
    } catch (error) {
      open.database.exec('ROLLBACK')
      throw error
    }
    const workspace = readWorkspace(open)
    await this.touchRecent(workspace)
    return workspace
  }

  async rename(id: string, rawTitle: string) {
    await this.index()
    const open = this.openById(id)
    if (!open) return null
    const previous = readWorkspace(open)
    const title = normalizeDeckTitle(rawTitle)
    const now = new Date().toISOString()

    // Keep the on-disk filename in sync with the title for Ark-managed files in
    // the default workspaces directory, where the name is derived from the
    // title at creation. Files at user-chosen paths keep their names; Move
    // exists for that. A title that already matches the current filename skips
    // the file rename entirely.
    if (path.dirname(open.path) === this.defaultDir) {
      const targetPath = await this.uniquePath(title, path.dirname(open.path))
      if (targetPath !== open.path) {
        open.database.prepare('UPDATE workspace SET title = ?, updated_at = ?').run(title, now)
        open.database.close()
        this.byId.delete(id)
        this.byPath.delete(open.path)
        try {
          await rename(open.path, targetPath)
          const workspace = readWorkspace(this.openFile(targetPath))
          await this.touchRecent(workspace)
          return workspace
        } catch (error) {
          // Roll the file rename back: reopen the original path and restore the
          // previous title so the deck does not half-rename.
          const reopened = this.openFile(open.path)
          reopened.database
            .prepare('UPDATE workspace SET title = ?, updated_at = ?')
            .run(previous.title, previous.updatedAt)
          throw error
        }
      }
    }

    open.database.prepare('UPDATE workspace SET title = ?, updated_at = ?').run(title, now)
    const workspace = readWorkspace(open)
    await this.touchRecent(workspace)
    return workspace
  }

  async delete(id: string) {
    await this.index()
    const open = this.openById(id)
    if (!open) return false
    open.database.close()
    this.byId.delete(id)
    this.byPath.delete(open.path)
    try {
      await unlink(open.path)
      this.recent.delete(id)
      await this.persistRecent()
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.recent.delete(id)
        await this.persistRecent()
        return false
      }
      this.openFile(open.path)
      throw error
    }
  }

  async database(id: string) {
    await this.index()
    return this.openById(id)?.database ?? null
  }

  async readThumbnail(
    id: string,
    slideHash: string,
    rendererVersion: string,
    manifestHash: string,
  ) {
    const database = await this.database(id)
    if (!database) return null
    const row = database
      .prepare(
        `SELECT media_type, width, height, image FROM thumbnails
         WHERE slide_hash = ? AND renderer_version = ? AND manifest_hash = ?`,
      )
      .get(slideHash, rendererVersion, manifestHash) as
      { media_type: string; width: number; height: number; image: Uint8Array } | undefined
    return row
      ? {
          mediaType: row.media_type,
          width: row.width,
          height: row.height,
          image: Buffer.from(row.image),
        }
      : null
  }

  async writeThumbnail(
    id: string,
    input: {
      slideHash: string
      rendererVersion: string
      manifestHash: string
      mediaType: string
      width: number
      height: number
      image: Buffer
      cover?: boolean
    },
  ) {
    const database = await this.database(id)
    if (!database) return false
    database
      .prepare(
        `INSERT INTO thumbnails
         (slide_hash, renderer_version, manifest_hash, media_type, width, height, image, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slide_hash, renderer_version, manifest_hash) DO UPDATE SET
           media_type = excluded.media_type,
           width = excluded.width,
           height = excluded.height,
           image = excluded.image,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.slideHash,
        input.rendererVersion,
        input.manifestHash,
        input.mediaType,
        input.width,
        input.height,
        input.image,
        new Date().toISOString(),
      )
    if (input.cover) {
      const recent = this.recent.get(id)
      if (recent) {
        recent.cover = `data:${input.mediaType};base64,${input.image.toString('base64')}`
        await this.persistRecent()
      }
    }
    return true
  }

  async pruneThumbnails(
    id: string,
    slideHashes: readonly string[],
    rendererVersion: string,
    manifestHash: string,
  ) {
    const database = await this.database(id)
    if (!database) return false
    if (slideHashes.length === 0) {
      database.prepare('DELETE FROM thumbnails').run()
      return true
    }
    database
      .prepare(
        `DELETE FROM thumbnails
         WHERE renderer_version != ? OR manifest_hash != ?
            OR slide_hash NOT IN (${slideHashes.map(() => '?').join(', ')})`,
      )
      .run(rendererVersion, manifestHash, ...slideHashes)
    return true
  }

  async saveAs(id: string, targetPath: string) {
    await this.index()
    const open = this.openById(id)
    if (!open) return null
    const resolved = path.resolve(targetPath)
    if (resolved === open.path) return readWorkspace(open)
    if (this.byPath.has(resolved)) throw new Error('The selected workspace is already open.')
    await mkdir(path.dirname(resolved), { recursive: true })
    try {
      await access(resolved)
      throw new Error('A file already exists at the selected workspace path.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await backup(open.database, resolved)
    open.database.close()
    this.byId.delete(id)
    this.byPath.delete(open.path)
    const workspace = readWorkspace(this.openFile(resolved))
    await this.touchRecent(workspace)
    return workspace
  }

  async move(id: string, targetPath: string) {
    await this.index()
    const open = this.openById(id)
    if (!open) return null
    const resolved = path.resolve(targetPath)
    if (resolved === open.path) return readWorkspace(open)
    if (this.byPath.has(resolved)) throw new Error('The selected workspace is already open.')
    await mkdir(path.dirname(resolved), { recursive: true })
    try {
      await access(resolved)
      throw new Error('A file already exists at the selected workspace path.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    open.database.close()
    this.byId.delete(id)
    this.byPath.delete(open.path)
    try {
      await rename(open.path, resolved)
      const workspace = readWorkspace(this.openFile(resolved))
      await this.touchRecent(workspace)
      return workspace
    } catch (error) {
      this.openFile(open.path)
      throw error
    }
  }

  async duplicate(
    id: string,
    mode: 'presentation' | 'complete',
    targetPath?: string,
    selectedThreadIds?: readonly string[],
  ) {
    await this.index()
    const source = this.openById(id)
    if (!source) return null
    const current = readWorkspace(source)
    const selected = selectedThreadIds ? [...new Set(selectedThreadIds)] : null
    const messageReferenceClause =
      mode === 'complete'
        ? selected
          ? selected.length > 0
            ? ` OR (owner_type = 'message' AND owner_id IN
                 (SELECT id FROM messages WHERE thread_id IN (${selected.map(() => '?').join(', ')})))`
            : ''
          : " OR owner_type = 'message'"
        : ''
    const assetRows = source.database
      .prepare(
        `SELECT a.*, b.bytes FROM assets a JOIN blobs b ON b.checksum = a.blob_checksum
         WHERE a.id IN
           (SELECT asset_id FROM asset_references
            WHERE owner_type = 'document'${messageReferenceClause})`,
      )
      .all(...(mode === 'complete' && selected ? selected : [])) as Array<Record<string, unknown>>
    const assets: EmbeddedAsset[] = assetRows.map((row) => ({
      id: String(row.id),
      filename: String(row.filename),
      mediaType: String(row.media_type),
      category: String(row.category) as EmbeddedAsset['category'],
      source: String(row.source) as EmbeddedAsset['source'],
      bytes: Buffer.from(row.bytes as Uint8Array),
    }))
    const copy = await this.create(
      current.html,
      randomUUID(),
      targetPath ?? (await this.uniquePath(`${current.title} Copy`)),
      assets,
    )
    const destination = await this.database(copy.id)
    if (!destination) throw new Error('Could not open duplicated workspace.')

    if (mode === 'complete') {
      const allowedThreads = selected ? new Set(selected) : null
      const threads = source.database
        .prepare('SELECT * FROM threads ORDER BY created_at')
        .all() as Array<Record<string, unknown>>
      const threadIds = new Map<string, string>()
      const messageIds = new Map<string, string>()
      for (const thread of threads) {
        if (allowedThreads && !allowedThreads.has(String(thread.id))) continue
        const nextId = randomUUID()
        threadIds.set(String(thread.id), nextId)
        destination
          .prepare(
            `INSERT INTO threads
             (id, title, visibility, created_by, created_at, updated_at, archived_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            nextId,
            thread.title as string,
            thread.visibility as string,
            thread.created_by as string | null,
            thread.created_at as string,
            thread.updated_at as string,
            thread.archived_at as string | null,
          )
      }
      const messages = source.database
        .prepare('SELECT * FROM messages ORDER BY sequence')
        .all() as Array<Record<string, unknown>>
      for (const message of messages) {
        const nextThreadId = threadIds.get(String(message.thread_id))
        if (!nextThreadId) continue
        const nextId = randomUUID()
        messageIds.set(String(message.id), nextId)
        const content = JSON.parse(String(message.content_json)) as Record<string, unknown>
        content.id = nextId
        content.threadId = nextThreadId
        content.deckId = copy.id
        destination
          .prepare(
            `INSERT INTO messages
             (id, thread_id, sequence, role, content_json, created_by, model, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            nextId,
            nextThreadId,
            message.sequence as number,
            message.role as string,
            JSON.stringify(content),
            message.created_by as string | null,
            message.model as string | null,
            message.created_at as string,
            message.updated_at as string | null,
          )
      }
      const refs = source.database
        .prepare("SELECT * FROM asset_references WHERE owner_type = 'message'")
        .all() as Array<Record<string, unknown>>
      for (const ref of refs) {
        const ownerId = messageIds.get(String(ref.owner_id))
        if (!ownerId) continue
        destination
          .prepare(
            `INSERT OR IGNORE INTO asset_references
             (asset_id, owner_type, owner_id, purpose) VALUES (?, 'message', ?, ?)`,
          )
          .run(ref.asset_id as string, ownerId, ref.purpose as string)
      }
    }
    return readWorkspace(this.byId.get(copy.id)!)
  }

  close() {
    for (const open of this.byId.values()) open.database.close()
    this.byId.clear()
    this.byPath.clear()
    this.indexed = false
  }
}

export function createWorkspaceStore(rootDir?: string) {
  return new WorkspaceStore(rootDir)
}
