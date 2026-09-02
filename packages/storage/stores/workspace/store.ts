import { randomUUID } from 'node:crypto'
import { access, mkdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'

import { extractDeckTitle, normalizeDeckTitle } from '@ark/deck/document/title.ts'
import { isValidDeckId } from '@ark/deck/document/id.ts'
import { syncDeckHtmlTitle } from '@ark/deck/document/title.ts'
import { DEFAULT_DECK_ORIGIN, type DeckOrigin } from '@ark/deck/document/origin.ts'
import type { EmbeddedAsset } from '../../records/embedded-assets.ts'
import { insertEmbeddedAssets, syncDocumentAssetReferences } from './assets.ts'
import {
  defaultWorkspaceDir,
  inspectWorkspaceFile,
  readWorkspace,
  recentWorkspacesPath,
  safeFileStem,
} from './file.ts'
import {
  ARK_APPLICATION_ID,
  ARK_WORKSPACE_FORMAT_VERSION,
  configure,
  contentHash,
  migrate,
  removeRollbackJournal,
  SCHEMA,
} from './schema.ts'
import { appendDocumentHistory } from './history.ts'
import { DocumentWriter } from './document-writer.ts'
import { RecentList } from './recent-list.ts'
import { ThumbnailFiles } from './thumbnail-files.ts'
import type { OpenWorkspace, WorkspaceRow } from './types.ts'
import type { DocumentHistorySource } from '../../records/document-history.ts'

export class WorkspaceStore {
  private defaultDir: string
  private readonly recents: RecentList
  private readonly thumbnails: ThumbnailFiles
  private readonly documents: DocumentWriter
  private readonly byId = new Map<string, OpenWorkspace>()
  private readonly byPath = new Map<string, OpenWorkspace>()
  private indexed = false
  private pendingFileMove: Promise<void> | null = null

  constructor(rootDir?: string) {
    this.defaultDir = path.resolve(rootDir ?? defaultWorkspaceDir())
    this.recents = new RecentList(
      rootDir ? path.join(this.defaultDir, 'recent-workspaces.json') : recentWorkspacesPath(),
    )
    this.thumbnails = new ThumbnailFiles((id) => this.database(id), this.recents)
    this.documents = new DocumentWriter({
      index: () => this.index(),
      openById: (id) => this.openById(id),
      getOpen: (id) => this.byId.get(id),
      uniquePath: (title, directory, selfPath) => this.uniquePath(title, directory, selfPath),
      renameOpenWorkspaceFile: (open, targetPath) => this.renameOpenWorkspaceFile(open, targetPath),
      recents: this.recents,
    })
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

  private closeDatabase(database: DatabaseSync, filePath: string) {
    database.close()
    removeRollbackJournal(filePath)
  }

  private async index() {
    // A file move deregisters its workspace across an await; every public
    // method funnels through here, so waiting for it keeps other requests from
    // reopening the file at its stale path mid-move.
    while (this.pendingFileMove) await this.pendingFileMove
    if (this.indexed) return
    await this.recents.loadIfNeeded()
    await this.recents.ingestDirectory(this.rootDir)
    this.indexed = true
    await this.recents.persist()
  }

  private openById(id: string) {
    const existing = this.byId.get(id)
    if (existing) return existing
    const recent = this.recents.get(id)
    if (!recent) return null
    try {
      const metadata = inspectWorkspaceFile(recent.path)
      if (metadata.id !== id) return null
      return this.openFile(recent.path)
    } catch {
      return null
    }
  }

  private openAdopted(filePath: string) {
    const open = this.openFile(filePath)
    const current = readWorkspace(open)
    const title = this.titleFromFileName(open.path, current.title)
    if (title) {
      this.adoptFileName(open, current, title)
    }
    return readWorkspace(open)
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
    this.byId.delete(open.id)
    this.byPath.delete(open.path)
    this.closeDatabase(open.database, open.path)
    try {
      await rename(open.path, targetPath)
      return readWorkspace(this.openFile(targetPath))
    } catch (error) {
      this.openFile(open.path)
      throw error
    }
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
        appendDocumentHistory(open.database, {
          revision: current.documentRevision + 1,
          html: syncedHtml,
          source: 'editor',
          createdAt: now,
        })
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
    if (targetExists) await this.recents.forgetAtPath(filePath, id)
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
      this.closeDatabase(database, staged)
      await unlink(staged).catch(() => undefined)
      throw error
    }

    this.closeDatabase(database, staged)
    try {
      await rename(staged, filePath)
    } catch (error) {
      await unlink(staged).catch(() => undefined)
      throw error
    }
    const open = this.openFile(filePath)
    const workspace = readWorkspace(open)
    await this.recents.touch(workspace)
    return workspace
  }

  async open(filePath: string) {
    await this.index()
    const workspace = this.openAdopted(filePath)
    await this.recents.touch(workspace)
    return workspace
  }

  async get(id: string) {
    await this.index()
    const open = this.openById(id)
    return open ? readWorkspace(open) : null
  }

  async listRecent() {
    await this.index()
    return this.recents.list(this.byId)
  }

  async removeRecent(id: string) {
    await this.index()
    return this.recents.remove(id)
  }

  async locate(id: string, filePath: string) {
    await this.index()
    return this.recents.locate(id, filePath, (adoptedPath) => this.openAdopted(adoptedPath))
  }

  async listDocumentHistory(id: string) {
    return this.documents.listDocumentHistory(id)
  }

  /**
   * The HTML of one history snapshot, so callers can validate before restoring.
   * Null means the deck is unknown; a missing snapshot throws, matching
   * `restoreDocument`.
   */
  async readDocumentHistoryHtml(id: string, historyRevision: number) {
    return this.documents.readDocumentHistoryHtml(id, historyRevision)
  }

  async restoreDocument(id: string, historyRevision: number, expectedDocumentRevision: number) {
    return this.documents.restoreDocument(id, historyRevision, expectedDocumentRevision)
  }

  async updateDocument(
    id: string,
    html: string,
    expectedDocumentRevision: number,
    embeddedAssets: readonly EmbeddedAsset[] = [],
    historySource: DocumentHistorySource = 'editor',
    options: { preserveTitle?: boolean } = {},
  ) {
    return this.documents.updateDocument(
      id,
      html,
      expectedDocumentRevision,
      embeddedAssets,
      historySource,
      options,
    )
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
      let workspace: WorkspaceRow
      try {
        workspace = await this.renameOpenWorkspaceFile(open, targetPath)
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
      // Past the file move, so the rollback above no longer applies: it would
      // reopen a path that no longer exists, creating a stray empty database
      // there and masking whatever actually failed.
      this.documents.appendRenameHistory(
        workspace.id,
        htmlChanged,
        workspace.documentRevision,
        workspace.html,
        now,
      )
      await this.recents.touch(workspace)
      return workspace
    }
    this.documents.appendRenameHistory(
      open.id,
      htmlChanged,
      previous.documentRevision + 1,
      syncedHtml,
      now,
    )
    const workspace = readWorkspace(open)
    await this.recents.touch(workspace)
    return workspace
  }

  async delete(id: string) {
    await this.index()
    const open = this.openById(id)
    if (!open) return false
    this.byId.delete(id)
    this.byPath.delete(open.path)
    this.closeDatabase(open.database, open.path)
    try {
      await unlink(open.path)
      this.recents.delete(id)
      await this.recents.persist()
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.recents.delete(id)
        await this.recents.persist()
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
    return this.thumbnails.readThumbnail(id, slideHash, rendererVersion, manifestHash)
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
    return this.thumbnails.writeThumbnail(id, input)
  }

  async pruneThumbnails(
    id: string,
    slideHashes: readonly string[],
    rendererVersion: string,
    manifestHash: string,
  ) {
    return this.thumbnails.pruneThumbnails(id, slideHashes, rendererVersion, manifestHash)
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
    if (targetExists) await this.recents.forgetAtPath(resolved, id)
    // Back up beside the destination and swap it in, so a failed backup never
    // destroys the file being overwritten.
    const staged = `${resolved}.${randomUUID()}.tmp`
    try {
      await backup(open.database, staged)
      removeRollbackJournal(staged)
      await rename(staged, resolved)
    } catch (error) {
      await unlink(staged).catch(() => undefined)
      removeRollbackJournal(staged)
      throw error
    }
    this.byId.delete(id)
    this.byPath.delete(open.path)
    this.closeDatabase(open.database, open.path)
    const reopened = this.openFile(resolved)
    const workspace = readWorkspace(reopened)
    await this.recents.touch(workspace)
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
    if (targetExists) await this.recents.forgetAtPath(resolved, id)
    const workspace = await this.renameOpenWorkspaceFile(open, resolved)
    await this.recents.touch(workspace)
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
    try {
      this.recents.persistSync()
    } catch (error) {
      console.warn('Could not persist recent workspaces.', error)
    }

    const openWorkspaces = [...this.byId.values()]
    this.byId.clear()
    this.byPath.clear()
    this.indexed = false

    for (const open of openWorkspaces) {
      try {
        this.closeDatabase(open.database, open.path)
      } catch (error) {
        console.warn(`Could not close workspace at ${open.path}.`, error)
      }
    }
  }
}

export function createWorkspaceStore(rootDir?: string) {
  return new WorkspaceStore(rootDir)
}
