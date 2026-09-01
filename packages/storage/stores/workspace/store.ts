import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'

import { extractDeckTitle, normalizeDeckTitle } from '@ark/deck/document/title.ts'
import { isValidDeckId } from '@ark/deck/document/id.ts'
import { syncDeckHtmlTitle } from '@ark/deck/document/title.ts'
import {
  DEFAULT_DECK_ORIGIN,
  deckOriginAfterWrite,
  type DeckOrigin,
} from '@ark/deck/document/origin.ts'
import type { EmbeddedAsset } from '../../records/embedded-assets.ts'
import {
  garbageCollectUnreferencedAssets,
  insertEmbeddedAssets,
  syncDocumentAssetReferences,
} from './assets.ts'
import {
  defaultWorkspaceDir,
  inspectWorkspaceFile,
  readWorkspace,
  readWorkspaceMetadata,
  recentWorkspacesPath,
  safeFileStem,
} from './file.ts'
import {
  ARK_APPLICATION_ID,
  ARK_WORKSPACE_FORMAT_VERSION,
  configure,
  contentHash,
  migrate,
  SCHEMA,
} from './schema.ts'
import { appendDocumentHistory, listDocumentHistory, readDocumentHistoryHtml } from './history.ts'
import { WorkspaceDocumentConflictError, WorkspaceDocumentHistoryNotFoundError } from './types.ts'
import type { OpenWorkspace, RecentWorkspace, WorkspaceRow } from './types.ts'
import type { DocumentHistorySource } from '../../records/document-history.ts'

export class WorkspaceStore {
  private defaultDir: string
  private readonly recentFilePath: string
  private readonly byId = new Map<string, OpenWorkspace>()
  private readonly byPath = new Map<string, OpenWorkspace>()
  private indexed = false
  private readonly recent = new Map<string, RecentWorkspace>()
  private recentLoaded = false
  private pendingFileMove: Promise<void> | null = null

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
    // A file move deregisters its workspace across an await; every public
    // method funnels through here, so waiting for it keeps other requests from
    // reopening the file at its stale path mid-move.
    while (this.pendingFileMove) await this.pendingFileMove
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

  /**
   * Move an open workspace file on disk. The SQLite handle is closed first so
   * the rename works on Windows, then reopened at the new path and re-registered.
   * On failure the original path is reopened and the error rethrown.
   */
  private async renameOpenWorkspaceFile(open: OpenWorkspace, targetPath: string) {
    // The workspace is unregistered across the rename await, so a concurrent
    // request must not reopen it from the recent index at the stale path.
    // index() — which every public method awaits first — waits this out.
    const move = this.moveUnregisteredWorkspaceFile(open, targetPath)
    this.pendingFileMove = move.then(
      () => undefined,
      () => undefined,
    )
    try {
      return await move
    } finally {
      this.pendingFileMove = null
    }
  }

  private async moveUnregisteredWorkspaceFile(open: OpenWorkspace, targetPath: string) {
    open.database.close()
    this.byId.delete(open.id)
    this.byPath.delete(open.path)
    try {
      await rename(open.path, targetPath)
      return readWorkspace(this.openFile(targetPath))
    } catch (error) {
      this.openFile(open.path)
      throw error
    }
  }

  /**
   * Forget the recent-index row for a file that is about to be replaced. The
   * overwritten workspace's id still resolves to that path, so leaving it
   * listed shows a dashboard entry that opens a different deck.
   */
  private async forgetRecentAtPath(filePath: string, keepId?: string) {
    const resolved = path.resolve(filePath)
    let changed = false
    for (const [id, entry] of this.recent) {
      if (id === keepId || path.resolve(entry.path) !== resolved) continue
      this.recent.delete(id)
      changed = true
    }
    if (changed) await this.persistRecent()
  }

  private async exists(filePath: string) {
    try {
      await access(filePath)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return false
    }
  }

  /**
   * Adopt a file-derived title: update the title row and keep the document
   * <title> in sync, bumping document_revision only when the document changes.
   */
  private adoptFileName(open: OpenWorkspace, current: WorkspaceRow, title: string) {
    const now = new Date().toISOString()
    const syncedHtml = syncDeckHtmlTitle(current.html, title)
    const htmlChanged = syncedHtml !== current.html
    open.database.exec('BEGIN IMMEDIATE')
    try {
      open.database.prepare('UPDATE workspace SET title = ?, updated_at = ?').run(title, now)
      if (htmlChanged) {
        open.database
          .prepare('UPDATE document SET html = ?, content_hash = ?, updated_at = ? WHERE id = 1')
          .run(syncedHtml, contentHash(syncedHtml), now)
        open.database
          .prepare('UPDATE workspace SET document_revision = document_revision + 1')
          .run()
      }
      open.database.exec('COMMIT')
    } catch (error) {
      open.database.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Derive a deck title from a file's name when it diverges from the stored
   * title — the user's latest statement of the name was renaming the file
   * itself. Collision-safe suffixes ("Board plan 2.ark" vs title "Board plan")
   * are recognized and do not override the title. Returns null when the file
   * name should not change the title.
   */
  private titleFromFileName(filePath: string, currentTitle: string) {
    const fileStem = safeFileStem(path.basename(filePath).replace(/\.ark$/i, ''))
    const titleStem = safeFileStem(currentTitle)
    if (fileStem === titleStem) return null
    const escaped = titleStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`^${escaped}( \\d+)?$`).test(fileStem)) return null
    return fileStem
  }

  /**
   * First free `<stem>.ark` (then " 2", " 3", …) in a directory. `selfPath` is
   * the caller's own file: a name that lands back on it is already free, so
   * renaming a deck to the name its file already has is a no-op instead of a
   * spurious " 2" suffix.
   */
  private async uniquePath(title: string, directory: string = this.rootDir, selfPath?: string) {
    const stem = safeFileStem(title)
    for (let suffix = 1; ; suffix += 1) {
      const candidate = path.join(directory, `${stem}${suffix === 1 ? '' : ` ${suffix}`}.ark`)
      if (selfPath && candidate === path.resolve(selfPath)) return candidate
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
    overwrite = false,
  ) {
    await this.index()
    const id = requestedId ?? randomUUID()
    if (!isValidDeckId(id) || this.byId.has(id)) throw new Error('Workspace id is invalid or used.')

    const title = extractDeckTitle(html)
    const filePath = path.resolve(targetPath ?? (await this.uniquePath(title)))
    await mkdir(path.dirname(filePath), { recursive: true })
    if (this.byPath.has(filePath)) throw new Error('The selected workspace is already open.')
    const targetExists = await this.exists(filePath)
    if (targetExists && !overwrite) {
      throw new Error('A file already exists at the selected workspace path.')
    }
    if (targetExists) await this.forgetRecentAtPath(filePath, id)
    // Build the workspace beside its destination and swap it in once it is
    // complete, so a failed build never destroys the file being overwritten.
    const staged = `${filePath}.${randomUUID()}.tmp`
    const database = new DatabaseSync(staged)

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
        appendDocumentHistory(database, {
          revision: 1,
          html,
          source: 'create',
          createdAt: now,
        })
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    } catch (error) {
      database.close()
      await unlink(staged).catch(() => undefined)
      throw error
    }

    database.close()
    try {
      await rename(staged, filePath)
    } catch (error) {
      await unlink(staged).catch(() => undefined)
      throw error
    }
    const open = this.openFile(filePath)
    const workspace = readWorkspace(open)
    await this.touchRecent(workspace)
    return workspace
  }

  async open(filePath: string) {
    await this.index()
    const open = this.openFile(filePath)
    const current = readWorkspace(open)
    const title = this.titleFromFileName(open.path, current.title)
    if (title) {
      this.adoptFileName(open, current, title)
    }
    const workspace = readWorkspace(open)
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
    const open = this.openFile(filePath)
    const current = readWorkspace(open)
    const title = this.titleFromFileName(open.path, current.title)
    if (title) {
      this.adoptFileName(open, current, title)
    }
    const workspace = readWorkspace(open)
    await this.touchRecent(workspace)
    return workspace
  }

  async listDocumentHistory(id: string) {
    await this.index()
    const open = this.openById(id)
    if (!open) return null
    return listDocumentHistory(open.database)
  }

  async restoreDocument(id: string, historyRevision: number, expectedDocumentRevision: number) {
    await this.index()
    const open = this.openById(id)
    if (!open) return null
    const html = readDocumentHistoryHtml(open.database, historyRevision)
    if (html === null) throw new WorkspaceDocumentHistoryNotFoundError(historyRevision)
    return this.updateDocument(id, html, expectedDocumentRevision, [], 'restore')
  }

  async updateDocument(
    id: string,
    html: string,
    expectedDocumentRevision: number,
    embeddedAssets: readonly EmbeddedAsset[] = [],
    historySource: DocumentHistorySource = 'editor',
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
      // Identical HTML is an autosave tick, not a committed history step.
      if (html !== current.html) {
        appendDocumentHistory(open.database, {
          revision: expectedDocumentRevision + 1,
          html,
          source: historySource,
          createdAt: now,
        })
      }
      open.database.exec('COMMIT')
    } catch (error) {
      open.database.exec('ROLLBACK')
      throw error
    }
    const workspace = readWorkspace(open)
    await this.touchRecent(workspace)

    // When the agent establishes a new title (the title row is still
    // auto-derived from HTML), keep the on-disk filename in sync wherever the
    // file lives. The target is collision-safe (Board plan.ark,
    // Board plan 2.ark) and never overwrites.
    if (title !== current.title) {
      const targetPath = await this.uniquePath(title, path.dirname(open.path), open.path)
      if (targetPath !== open.path) {
        try {
          const renamed = await this.renameOpenWorkspaceFile(open, targetPath)
          await this.touchRecent(renamed)
          return renamed
        } catch (error) {
          // The document save already committed; a cosmetic filename sync must
          // not fail the save. The helper restored the original open handle.
          console.warn('Could not rename the workspace file to match the deck title.', error)
        }
      }
    }

    return workspace
  }

  async rename(id: string, rawTitle: string) {
    await this.index()
    const open = this.openById(id)
    if (!open) return null
    const previous = readWorkspace(open)
    const title = normalizeDeckTitle(rawTitle)
    const now = new Date().toISOString()
    // Keep the document <title> in sync so the deck name, the on-disk file
    // name, and the exported HTML all agree. The revision bumps only when the
    // document actually changes, so the renderer can adopt the new revision.
    const syncedHtml = syncDeckHtmlTitle(previous.html, title)
    const htmlChanged = syncedHtml !== previous.html

    const writeMetadata = (
      target: OpenWorkspace,
      nextTitle: string,
      nextHtml: string,
      changed: boolean,
      updatedAt: string,
    ) => {
      target.database.exec('BEGIN IMMEDIATE')
      try {
        target.database
          .prepare('UPDATE workspace SET title = ?, updated_at = ?')
          .run(nextTitle, updatedAt)
        if (changed) {
          target.database
            .prepare('UPDATE document SET html = ?, content_hash = ?, updated_at = ? WHERE id = 1')
            .run(nextHtml, contentHash(nextHtml), updatedAt)
          target.database
            .prepare('UPDATE workspace SET document_revision = document_revision + 1')
            .run()
        }
        target.database.exec('COMMIT')
      } catch (error) {
        target.database.exec('ROLLBACK')
        throw error
      }
    }

    // Keep the on-disk filename in sync with the title wherever the file
    // lives: the deck name is the file name. The target is collision-safe
    // (Board plan.ark, Board plan 2.ark) and never overwrites. A title that
    // already matches the current filename skips the file rename entirely. A
    // user rename re-derives the name, so later agent-established titles keep
    // renaming the file too.
    const targetPath = await this.uniquePath(title, path.dirname(open.path), open.path)
    writeMetadata(open, title, syncedHtml, htmlChanged, now)
    if (targetPath !== open.path) {
      try {
        const workspace = await this.renameOpenWorkspaceFile(open, targetPath)
        await this.touchRecent(workspace)
        return workspace
      } catch (error) {
        // Roll the file rename back: reopen the original path and restore the
        // previous metadata so the deck does not half-rename.
        const reopened = this.openFile(open.path)
        writeMetadata(reopened, previous.title, previous.html, htmlChanged, previous.updatedAt)
        if (htmlChanged) {
          reopened.database
            .prepare('UPDATE workspace SET document_revision = ?')
            .run(previous.documentRevision)
        }
        throw error
      }
    }
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

  async saveAs(id: string, targetPath: string, overwrite = false) {
    await this.index()
    const open = this.openById(id)
    if (!open) return null
    const resolved = path.resolve(targetPath)
    if (resolved === open.path) return readWorkspace(open)
    if (this.byPath.has(resolved)) throw new Error('The selected workspace is already open.')
    await mkdir(path.dirname(resolved), { recursive: true })
    const targetExists = await this.exists(resolved)
    if (targetExists && !overwrite) {
      throw new Error('A file already exists at the selected workspace path.')
    }
    if (targetExists) await this.forgetRecentAtPath(resolved, id)
    // Back up beside the destination and swap it in, so a failed backup never
    // destroys the file being overwritten.
    const staged = `${resolved}.${randomUUID()}.tmp`
    try {
      await backup(open.database, staged)
      await rename(staged, resolved)
    } catch (error) {
      await unlink(staged).catch(() => undefined)
      throw error
    }
    open.database.close()
    this.byId.delete(id)
    this.byPath.delete(open.path)
    const reopened = this.openFile(resolved)
    const workspace = readWorkspace(reopened)
    await this.touchRecent(workspace)
    return workspace
  }

  async move(id: string, targetPath: string, overwrite = false) {
    await this.index()
    const open = this.openById(id)
    if (!open) return null
    const resolved = path.resolve(targetPath)
    if (resolved === open.path) return readWorkspace(open)
    if (this.byPath.has(resolved)) throw new Error('The selected workspace is already open.')
    await mkdir(path.dirname(resolved), { recursive: true })
    const targetExists = await this.exists(resolved)
    if (targetExists && !overwrite) {
      throw new Error('A file already exists at the selected workspace path.')
    }
    // rename() replaces the destination atomically, so a confirmed overwrite
    // never leaves the target missing.
    if (targetExists) await this.forgetRecentAtPath(resolved, id)
    const workspace = await this.renameOpenWorkspaceFile(open, resolved)
    await this.touchRecent(workspace)
    return workspace
  }

  async duplicate(
    id: string,
    mode: 'presentation' | 'complete',
    targetPath?: string,
    selectedThreadIds?: readonly string[],
    overwrite = false,
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
      DEFAULT_DECK_ORIGIN,
      overwrite,
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
