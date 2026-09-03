/** Save As, move, duplicate, rename, and the on-disk path helpers they share. */

import { randomUUID } from 'node:crypto'
import { access, mkdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { backup, type DatabaseSync } from 'node:sqlite'

import { DEFAULT_DECK_ORIGIN, type DeckOrigin } from '@ark/deck/document/origin.ts'
import { normalizeDeckTitle, syncDeckHtmlTitle } from '@ark/deck/document/title.ts'

import type { EmbeddedAsset } from '../../records/embedded-assets.ts'
import { readWorkspace, safeFileStem } from './file.ts'
import { appendDocumentHistory } from './history.ts'
import type { RecentList } from './recent-list.ts'
import { contentHash, removeRollbackJournal } from './schema.ts'
import type { OpenWorkspace, WorkspaceRow } from './types.ts'

export type FileOpsDeps = {
  rootDir: () => string
  byId: Map<string, OpenWorkspace>
  byPath: Map<string, OpenWorkspace>
  recents: RecentList
  getPendingFileMove: () => Promise<void> | null
  setPendingFileMove: (value: Promise<void> | null) => void
  openFile: (filePath: string) => OpenWorkspace
  closeDatabase: (database: DatabaseSync, filePath: string) => void
  openById: (id: string) => OpenWorkspace | null
  index: () => Promise<void>
  create: (
    html: string,
    requestedId?: string,
    targetPath?: string,
    embeddedAssets?: readonly EmbeddedAsset[],
    origin?: DeckOrigin,
    overwrite?: boolean,
  ) => Promise<WorkspaceRow>
  database: (id: string) => Promise<DatabaseSync | null>
  appendRenameHistory: (
    id: string,
    htmlChanged: boolean,
    revision: number,
    html: string,
    createdAt: string,
  ) => void
}

export class FileOps {
  private readonly deps: FileOpsDeps

  constructor(deps: FileOpsDeps) {
    this.deps = deps
  }

  async exists(filePath: string) {
    try {
      await access(filePath)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return false
    }
  }

  /**
   * First free `<stem>.ark` (then " 2", " 3", …) in a directory. `selfPath` is
   * the caller's own file: a name that lands back on it is already free, so
   * renaming a deck to the name its file already has is a no-op instead of a
   * spurious " 2" suffix.
   */
  async uniquePath(title: string, directory: string = this.deps.rootDir(), selfPath?: string) {
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

  /**
   * Move an open workspace file on disk. The SQLite handle is closed first so
   * the rename works on Windows, then reopened at the new path and re-registered.
   * On failure the original path is reopened and the error rethrown.
   */
  async renameOpenWorkspaceFile(open: OpenWorkspace, targetPath: string) {
    // The workspace is unregistered across the rename await, so a concurrent
    // request must not reopen it from the recent index at the stale path.
    // index() — which every public method awaits first — waits this out.
    const move = this.moveUnregisteredWorkspaceFile(open, targetPath)
    this.deps.setPendingFileMove(
      move.then(
        () => undefined,
        () => undefined,
      ),
    )
    try {
      return await move
    } finally {
      this.deps.setPendingFileMove(null)
    }
  }

  private async moveUnregisteredWorkspaceFile(open: OpenWorkspace, targetPath: string) {
    this.deps.byId.delete(open.id)
    this.deps.byPath.delete(open.path)
    this.deps.closeDatabase(open.database, open.path)
    try {
      await rename(open.path, targetPath)
      return readWorkspace(this.deps.openFile(targetPath))
    } catch (error) {
      this.deps.openFile(open.path)
      throw error
    }
  }

  /**
   * Adopt a file-derived title: update the title row and keep the document
   * <title> in sync, bumping document_revision only when the document changes.
   */
  adoptFileName(open: OpenWorkspace, current: WorkspaceRow, title: string) {
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
  titleFromFileName(filePath: string, currentTitle: string) {
    const fileStem = safeFileStem(path.basename(filePath).replace(/\.ark$/i, ''))
    const titleStem = safeFileStem(currentTitle)
    if (fileStem === titleStem) return null
    const escaped = titleStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`^${escaped}( \\d+)?$`).test(fileStem)) return null
    return fileStem
  }

  openAdopted(filePath: string) {
    const open = this.deps.openFile(filePath)
    const current = readWorkspace(open)
    const title = this.titleFromFileName(open.path, current.title)
    if (title) {
      this.adoptFileName(open, current, title)
    }
    return readWorkspace(open)
  }

  async saveAs(id: string, targetPath: string, overwrite = false) {
    await this.deps.index()
    const open = this.deps.openById(id)
    if (!open) return null
    const resolved = path.resolve(targetPath)
    if (resolved === open.path) return readWorkspace(open)
    if (this.deps.byPath.has(resolved)) throw new Error('The selected workspace is already open.')
    await mkdir(path.dirname(resolved), { recursive: true })
    const targetExists = await this.exists(resolved)
    if (targetExists && !overwrite) {
      throw new Error('A file already exists at the selected workspace path.')
    }
    if (targetExists) await this.deps.recents.forgetAtPath(resolved, id)
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
    this.deps.byId.delete(id)
    this.deps.byPath.delete(open.path)
    this.deps.closeDatabase(open.database, open.path)
    const reopened = this.deps.openFile(resolved)
    const workspace = readWorkspace(reopened)
    await this.deps.recents.touch(workspace)
    return workspace
  }

  async move(id: string, targetPath: string, overwrite = false) {
    await this.deps.index()
    const open = this.deps.openById(id)
    if (!open) return null
    const resolved = path.resolve(targetPath)
    if (resolved === open.path) return readWorkspace(open)
    if (this.deps.byPath.has(resolved)) throw new Error('The selected workspace is already open.')
    await mkdir(path.dirname(resolved), { recursive: true })
    const targetExists = await this.exists(resolved)
    if (targetExists && !overwrite) {
      throw new Error('A file already exists at the selected workspace path.')
    }
    // rename() replaces the destination atomically, so a confirmed overwrite
    // never leaves the target missing.
    if (targetExists) await this.deps.recents.forgetAtPath(resolved, id)
    const workspace = await this.renameOpenWorkspaceFile(open, resolved)
    await this.deps.recents.touch(workspace)
    return workspace
  }

  async duplicate(
    id: string,
    mode: 'presentation' | 'complete',
    targetPath?: string,
    selectedThreadIds?: readonly string[],
    overwrite = false,
  ) {
    await this.deps.index()
    const source = this.deps.openById(id)
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
    const copy = await this.deps.create(
      current.html,
      randomUUID(),
      targetPath ?? (await this.uniquePath(`${current.title} Copy`)),
      assets,
      DEFAULT_DECK_ORIGIN,
      overwrite,
    )
    const destination = await this.deps.database(copy.id)
    if (!destination) throw new Error('Could not open duplicated workspace.')

    if (mode === 'complete') {
      copyCompleteWorkspaceChat(source.database, destination, copy.id, selected)
    }
    return readWorkspace(this.deps.byId.get(copy.id)!)
  }

  async rename(id: string, rawTitle: string) {
    await this.deps.index()
    const open = this.deps.openById(id)
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
        const reopened = this.deps.openFile(open.path)
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
      this.deps.appendRenameHistory(
        workspace.id,
        htmlChanged,
        workspace.documentRevision,
        workspace.html,
        now,
      )
      await this.deps.recents.touch(workspace)
      return workspace
    }
    this.deps.appendRenameHistory(
      open.id,
      htmlChanged,
      previous.documentRevision + 1,
      syncedHtml,
      now,
    )
    const workspace = readWorkspace(open)
    await this.deps.recents.touch(workspace)
    return workspace
  }
}

function copyCompleteWorkspaceChat(
  source: DatabaseSync,
  destination: DatabaseSync,
  copyId: string,
  selected: string[] | null,
) {
  const allowedThreads = selected ? new Set(selected) : null
  const threads = source.prepare('SELECT * FROM threads ORDER BY created_at').all() as Array<
    Record<string, unknown>
  >
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
  const messages = source.prepare('SELECT * FROM messages ORDER BY sequence').all() as Array<
    Record<string, unknown>
  >
  for (const message of messages) {
    const nextThreadId = threadIds.get(String(message.thread_id))
    if (!nextThreadId) continue
    const nextId = randomUUID()
    messageIds.set(String(message.id), nextId)
    const content = JSON.parse(String(message.content_json)) as Record<string, unknown>
    content.id = nextId
    content.threadId = nextThreadId
    content.deckId = copyId
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
  const refs = source
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
