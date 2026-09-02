/** Recent-workspaces index: the disposable JSON list and its bookkeeping. */

import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { isValidDeckId } from '@ark/deck/document/id.ts'

import { inspectWorkspaceFile, readWorkspaceMetadata } from './file.ts'
import type { OpenWorkspace, RecentWorkspace, WorkspaceRow } from './types.ts'

export class RecentList {
  private readonly recent = new Map<string, RecentWorkspace>()
  private loaded = false

  constructor(private readonly filePath: string) {}

  get(id: string) {
    return this.recent.get(id)
  }

  delete(id: string) {
    return this.recent.delete(id)
  }

  values() {
    return this.recent.values()
  }

  private snapshot() {
    return JSON.stringify([...this.recent.values()], null, 2)
  }

  persistSync() {
    const filePath = this.filePath
    mkdirSync(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${randomUUID()}.tmp`
    writeFileSync(temporary, this.snapshot(), 'utf8')
    renameSync(temporary, filePath)
  }

  async persist() {
    const filePath = this.filePath
    await mkdir(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${randomUUID()}.tmp`
    await writeFile(temporary, this.snapshot(), 'utf8')
    await rename(temporary, filePath)
  }

  remember(workspace: WorkspaceRow) {
    const cover = this.recent.get(workspace.id)?.cover
    this.recent.set(workspace.id, {
      id: workspace.id,
      path: workspace.path,
      title: workspace.title,
      updatedAt: workspace.updatedAt,
      lastOpened: new Date().toISOString(),
      ...(cover ? { cover } : {}),
    })
  }

  async touch(workspace: WorkspaceRow) {
    this.remember(workspace)
    await this.persist()
  }

  /**
   * Forget the recent-index row for a file that is about to be replaced. The
   * overwritten workspace's id still resolves to that path, so leaving it
   * listed shows a dashboard entry that opens a different deck.
   */
  async forgetAtPath(filePath: string, keepId?: string) {
    const resolved = path.resolve(filePath)
    let changed = false
    for (const [id, entry] of this.recent) {
      if (id === keepId || path.resolve(entry.path) !== resolved) continue
      this.recent.delete(id)
      changed = true
    }
    if (changed) await this.persist()
  }

  async loadIfNeeded() {
    if (this.loaded) return
    try {
      const entries = JSON.parse(await readFile(this.filePath, 'utf8')) as RecentWorkspace[]
      for (const entry of entries) {
        if (isValidDeckId(entry.id) && typeof entry.path === 'string')
          this.recent.set(entry.id, entry)
      }
    } catch {
      // The recent index is disposable.
    }
    this.loaded = true
  }

  async ingestDirectory(rootDir: string) {
    await mkdir(rootDir, { recursive: true })
    const entries = await readdir(rootDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.ark')) continue
      try {
        const metadata = inspectWorkspaceFile(path.join(rootDir, entry.name))
        const existing = this.recent.get(metadata.id)
        // Recents JSON is disposable. Html-only document saves keep the
        // in-memory row current without rewriting that file; refresh
        // title/path/updatedAt from the `.ark` itself so a later process
        // still sorts by the document's real mtime.
        this.recent.set(metadata.id, {
          id: metadata.id,
          path: metadata.path,
          title: metadata.title,
          updatedAt: metadata.updatedAt,
          lastOpened: existing?.lastOpened ?? metadata.updatedAt,
          ...(existing?.cover ? { cover: existing.cover } : {}),
        })
      } catch {
        // Invalid files stay untouched and do not appear in Ark.
      }
    }
  }

  async list(byId: Map<string, OpenWorkspace>) {
    const summaries = await Promise.all(
      [...this.recent.values()].map(async (recent) => {
        const open = byId.get(recent.id)
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

  async remove(id: string) {
    const removed = this.recent.delete(id)
    if (removed) await this.persist()
    return removed
  }

  async locate(id: string, filePath: string, openAdopted: (filePath: string) => WorkspaceRow) {
    const metadata = inspectWorkspaceFile(filePath)
    if (metadata.id !== id) {
      throw new Error('Selected workspace has a different identity.')
    }
    const workspace = openAdopted(filePath)
    await this.touch(workspace)
    return workspace
  }
}
