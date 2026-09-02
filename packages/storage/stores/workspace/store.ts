import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { extractDeckTitle } from '@ark/deck/document/title.ts'
import { isValidDeckId } from '@ark/deck/document/id.ts'
import { DEFAULT_DECK_ORIGIN, type DeckOrigin } from '@ark/deck/document/origin.ts'
import type { EmbeddedAsset } from '../../records/embedded-assets.ts'
import { insertEmbeddedAssets, syncDocumentAssetReferences } from './assets.ts'
import { DocumentWriter } from './document-writer.ts'
import { FileOps } from './file-ops.ts'
import {
  defaultWorkspaceDir,
  inspectWorkspaceFile,
  readWorkspace,
  recentWorkspacesPath,
} from './file.ts'
import { appendDocumentHistory } from './history.ts'
import { RecentList } from './recent-list.ts'
import {
  ARK_APPLICATION_ID,
  ARK_WORKSPACE_FORMAT_VERSION,
  configure,
  contentHash,
  migrate,
  removeRollbackJournal,
  SCHEMA,
} from './schema.ts'
import { ThumbnailFiles } from './thumbnail-files.ts'
import type { OpenWorkspace } from './types.ts'
import type { DocumentHistorySource } from '@ark/deck/document/document-history.ts'

export class WorkspaceStore {
  private defaultDir: string
  private readonly recents: RecentList
  private readonly thumbnails: ThumbnailFiles
  private readonly documents: DocumentWriter
  private readonly fileOps: FileOps
  private readonly byId = new Map<string, OpenWorkspace>()
  private readonly byPath = new Map<string, OpenWorkspace>()
  private indexed = false
  private pendingFileMove: Promise<void> | null = null

  constructor(rootDir?: string) {
    this.defaultDir = path.resolve(rootDir ?? defaultWorkspaceDir())
    this.recents = new RecentList(
      rootDir ? path.join(this.defaultDir, 'recent-workspaces.json') : recentWorkspacesPath(),
    )
    this.fileOps = new FileOps({
      rootDir: () => this.defaultDir,
      byId: this.byId,
      byPath: this.byPath,
      recents: this.recents,
      getPendingFileMove: () => this.pendingFileMove,
      setPendingFileMove: (value) => {
        this.pendingFileMove = value
      },
      openFile: (filePath) => this.openFile(filePath),
      closeDatabase: (database, filePath) => this.closeDatabase(database, filePath),
      openById: (id) => this.openById(id),
      index: () => this.index(),
      create: (html, requestedId, targetPath, embeddedAssets, origin, overwrite) =>
        this.create(html, requestedId, targetPath, embeddedAssets, origin, overwrite),
      database: (id) => this.database(id),
      appendRenameHistory: (id, htmlChanged, revision, html, createdAt) =>
        this.documents.appendRenameHistory(id, htmlChanged, revision, html, createdAt),
    })
    this.documents = new DocumentWriter({
      index: () => this.index(),
      openById: (id) => this.openById(id),
      getOpen: (id) => this.byId.get(id),
      uniquePath: (title, directory, selfPath) =>
        this.fileOps.uniquePath(title, directory, selfPath),
      renameOpenWorkspaceFile: (open, targetPath) =>
        this.fileOps.renameOpenWorkspaceFile(open, targetPath),
      recents: this.recents,
    })
    this.thumbnails = new ThumbnailFiles((id) => this.database(id), this.recents)
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
    const filePath = path.resolve(targetPath ?? (await this.fileOps.uniquePath(title)))
    await mkdir(path.dirname(filePath), { recursive: true })
    if (this.byPath.has(filePath)) throw new Error('The selected workspace is already open.')
    const targetExists = await this.fileOps.exists(filePath)
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
    const workspace = this.fileOps.openAdopted(filePath)
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
    return this.recents.locate(id, filePath, (adoptedPath) => this.fileOps.openAdopted(adoptedPath))
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
    return this.fileOps.rename(id, rawTitle)
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
    return this.fileOps.saveAs(id, targetPath, overwrite)
  }

  async move(id: string, targetPath: string, overwrite = false) {
    return this.fileOps.move(id, targetPath, overwrite)
  }

  async duplicate(
    id: string,
    mode: 'presentation' | 'complete',
    targetPath?: string,
    selectedThreadIds?: readonly string[],
    overwrite = false,
  ) {
    return this.fileOps.duplicate(id, mode, targetPath, selectedThreadIds, overwrite)
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
