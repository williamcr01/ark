/** Document writes, restores, and history hooks for an open workspace. */

import path from 'node:path'

import { extractDeckTitle } from '@ark/deck/document/title.ts'
import { deckOriginAfterWrite } from '@ark/deck/document/origin.ts'

import type { EmbeddedAsset } from '../../records/embedded-assets.ts'
import type { DocumentHistorySource } from '@ark/deck/document/document-history.ts'
import {
  garbageCollectUnreferencedAssets,
  insertEmbeddedAssets,
  syncDocumentAssetReferences,
} from './assets.ts'
import { readWorkspace } from './file.ts'
import { appendDocumentHistory, listDocumentHistory, readDocumentHistoryHtml } from './history.ts'
import type { RecentList } from './recent-list.ts'
import { contentHash } from './schema.ts'
import { WorkspaceDocumentConflictError, WorkspaceDocumentHistoryNotFoundError } from './types.ts'
import type { OpenWorkspace, WorkspaceRow } from './types.ts'

export type DocumentWriterDeps = {
  index: () => Promise<void>
  openById: (id: string) => OpenWorkspace | null
  getOpen: (id: string) => OpenWorkspace | undefined
  uniquePath: (title: string, directory?: string, selfPath?: string) => Promise<string>
  renameOpenWorkspaceFile: (open: OpenWorkspace, targetPath: string) => Promise<WorkspaceRow>
  recents: RecentList
}

export class DocumentWriter {
  private readonly deps: DocumentWriterDeps

  constructor(deps: DocumentWriterDeps) {
    this.deps = deps
  }

  async listDocumentHistory(id: string) {
    await this.deps.index()
    const open = this.deps.openById(id)
    if (!open) return null
    return listDocumentHistory(open.database)
  }

  /**
   * The HTML of one history snapshot, so callers can validate before restoring.
   * Null means the deck is unknown; a missing snapshot throws, matching
   * `restoreDocument`.
   */
  async readDocumentHistoryHtml(id: string, historyRevision: number) {
    await this.deps.index()
    const open = this.deps.openById(id)
    if (!open) return null
    const html = readDocumentHistoryHtml(open.database, historyRevision)
    if (html === null) throw new WorkspaceDocumentHistoryNotFoundError(historyRevision)
    return html
  }

  async restoreDocument(id: string, historyRevision: number, expectedDocumentRevision: number) {
    await this.deps.index()
    const open = this.deps.openById(id)
    if (!open) return null
    const html = readDocumentHistoryHtml(open.database, historyRevision)
    if (html === null) throw new WorkspaceDocumentHistoryNotFoundError(historyRevision)
    // Keep the current title: a content rollback must not silently rename the
    // deck (and, through the filename sync below, the `.ark` file on disk)
    // just because the snapshot carries an older `<title>`.
    return this.updateDocument(id, html, expectedDocumentRevision, [], 'restore', {
      preserveTitle: true,
    })
  }

  async updateDocument(
    id: string,
    html: string,
    expectedDocumentRevision: number,
    embeddedAssets: readonly EmbeddedAsset[] = [],
    historySource: DocumentHistorySource = 'editor',
    options: { preserveTitle?: boolean } = {},
  ) {
    await this.deps.index()
    const open = this.deps.openById(id)
    if (!open) return null
    const current = readWorkspace(open)
    const nextExtractedTitle = extractDeckTitle(html)
    const title = options.preserveTitle
      ? current.title
      : current.title === extractDeckTitle(current.html)
        ? nextExtractedTitle
        : current.title
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
      // GC after history pins so a snapshot still referenced by
      // document_history cannot lose its ark-asset: blobs.
      garbageCollectUnreferencedAssets(open.database)
      open.database.exec('COMMIT')
    } catch (error) {
      open.database.exec('ROLLBACK')
      throw error
    }
    // The HTML we just wrote is still in memory. Re-SELECT would copy the
    // whole document back out of SQLite on every editor PATCH.
    const workspace: WorkspaceRow = {
      id: current.id,
      title,
      createdAt: current.createdAt,
      updatedAt: now,
      documentRevision: expectedDocumentRevision + 1,
      origin,
      html,
      path: open.path,
    }
    this.deps.recents.remember(workspace)

    // When the agent establishes a new title (the title row is still
    // auto-derived from HTML), keep the on-disk filename in sync wherever the
    // file lives. The target is collision-safe (Board plan.ark,
    // Board plan 2.ark) and never overwrites.
    //
    // Html-only editor saves (title and path unchanged) skip rewriting
    // recent-workspaces.json: that index is disposable, and writeFile+rename
    // on every PATCH sat on the persist path next to document_history. Create,
    // open, rename, and delete still persist eagerly. close() flushes the
    // in-memory rows so a workspace outside the managed directory still
    // sorts by its real updatedAt after restart. Durability of the document
    // and of full history snapshots is unchanged.
    if (title !== current.title) {
      await this.deps.recents.persist()
      const targetPath = await this.deps.uniquePath(title, path.dirname(open.path), open.path)
      if (targetPath !== open.path) {
        try {
          const renamed = await this.deps.renameOpenWorkspaceFile(open, targetPath)
          await this.deps.recents.touch(renamed)
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

  /**
   * A title rewrite that changes `<title>` (and therefore HTML) is a restore
   * point. Append after the rename succeeds so a rolled-back file move never
   * leaves a history row for a title that did not stick.
   */
  appendRenameHistory(
    id: string,
    htmlChanged: boolean,
    revision: number,
    html: string,
    createdAt: string,
  ) {
    if (!htmlChanged) return
    const open = this.deps.getOpen(id)
    if (!open) return
    appendDocumentHistory(open.database, {
      revision,
      html,
      source: 'editor',
      createdAt,
    })
  }
}
