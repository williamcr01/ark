import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { createAssetStore } from './asset-store.ts'
import { createChatStore } from './chat-store.ts'
import { createGenerationJobStore } from './generation-job-store.ts'
import { createWorkspaceStore, type WorkspaceStore } from './workspace-store.ts'
import {
  DOCUMENT_HISTORY_MAX_BYTES,
  DOCUMENT_HISTORY_MAX_ENTRIES,
} from '@ark/deck/document/document-history.ts'
import { garbageCollectUnreferencedAssets } from './workspace/assets.ts'
import { evictDocumentHistory } from './workspace/history.ts'

const html = `<!DOCTYPE html><html><head><title>Workspace</title></head><body><section class="slide"><h1>Hello</h1></section></body></html>`

describe('WorkspaceStore file operations', () => {
  let root = ''
  let store: WorkspaceStore | null = null

  afterEach(async () => {
    store?.close()
    store = null
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  async function setup() {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-workspaces-'))
    store = createWorkspaceStore(root)
    return store
  }

  it('rejects stale revisions atomically without changing the document', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    await workspaces.updateDocument(created.id, html.replace('Hello', 'Fresh'), 1)

    await expect(
      workspaces.updateDocument(created.id, html.replace('Hello', 'Stale'), 1),
    ).rejects.toMatchObject({ code: 'document_conflict', currentDocumentRevision: 2 })
    await expect(workspaces.get(created.id)).resolves.toMatchObject({
      documentRevision: 2,
      html: expect.stringContaining('Fresh'),
    })
  })

  it('leaves invalid and existing target files untouched', async () => {
    const workspaces = await setup()
    const target = path.join(root, 'Existing.ark')
    await writeFile(target, 'not a workspace', 'utf8')

    await expect(workspaces.open(target)).rejects.toThrow('Unsupported or invalid')
    await expect(workspaces.create(html, undefined, target)).rejects.toThrow('already exists')
    await expect(readFile(target, 'utf8')).resolves.toBe('not a workspace')
  })

  it('rejects unsupported format versions without compatibility handling', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    workspaces.close()

    let database = new DatabaseSync(created.path)
    database.exec('PRAGMA user_version = 2')
    database.close()

    store = createWorkspaceStore(root)
    await expect(store.open(created.path)).rejects.toThrow('Unsupported or invalid')
    store.close()

    database = new DatabaseSync(created.path)
    database.exec('PRAGMA user_version = 1; UPDATE workspace SET format_version = 2')
    database.close()

    store = createWorkspaceStore(root)
    await expect(store.open(created.path)).rejects.toThrow('Unsupported or invalid')
    database = new DatabaseSync(created.path, { readOnly: true })
    expect(database.prepare('SELECT format_version FROM workspace').get()).toEqual({
      format_version: 2,
    })
    database.close()
  })

  it('retires a blank origin on the first write that changes the document', async () => {
    const workspaces = await setup()
    const blank = `<!DOCTYPE html><html><head><title>Untitled Presentation</title></head><body><section class="slide"></section></body></html>`
    const created = await workspaces.create(blank, undefined, undefined, [], 'blank')

    expect(created.origin).toBe('blank')

    // Autosaving identical HTML is not authoring, and is not a history row.
    const resaved = await workspaces.updateDocument(created.id, blank, 1)
    expect(resaved?.origin).toBe('blank')
    expect(resaved?.documentRevision).toBe(2)
    await expect(workspaces.listDocumentHistory(created.id)).resolves.toEqual([
      expect.objectContaining({ revision: 1, source: 'create' }),
    ])

    const written = await workspaces.updateDocument(created.id, html, 2)
    expect(written?.origin).toBe('authored')

    // Origin is durable, and authored never reverts.
    const reverted = await workspaces.updateDocument(created.id, blank, 3)
    expect(reverted?.origin).toBe('authored')

    workspaces.close()
    store = createWorkspaceStore(root)
    await expect(store.open(created.path)).resolves.toMatchObject({ origin: 'authored' })
  })

  it('defaults decks written before the origin column to authored', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    workspaces.close()

    const database = new DatabaseSync(created.path)
    database.exec('ALTER TABLE workspace DROP COLUMN origin')
    database.close()

    store = createWorkspaceStore(root)
    await expect(store.open(created.path)).resolves.toMatchObject({ origin: 'authored' })
  })

  it('renames the on-disk file and syncs the document title in the default directory', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const originalPath = created.path
    expect(path.basename(originalPath)).toBe('Workspace.ark')

    const renamed = await workspaces.rename(created.id, 'Board plan')

    expect(renamed?.title).toBe('Board plan')
    expect(renamed?.path).toBe(path.join(root, 'Board plan.ark'))
    expect(renamed?.html).toContain('<title>Board plan</title>')
    expect(renamed?.documentRevision).toBe(2)
    await expect(workspaces.listDocumentHistory(created.id)).resolves.toEqual([
      expect.objectContaining({ revision: 1, source: 'create' }),
      expect.objectContaining({ revision: 2, source: 'editor' }),
    ])
    await expect(access(originalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(renamed!.path)).resolves.toBeUndefined()
    await expect(workspaces.get(created.id)).resolves.toMatchObject({
      title: 'Board plan',
      path: renamed?.path,
    })
    await expect(workspaces.listRecent()).resolves.toEqual([
      expect.objectContaining({ id: created.id, path: renamed?.path }),
    ])
  })

  it('picks a collision-safe filename when the new title target already exists', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    await workspaces.rename(created.id, 'Board plan')
    const second = await workspaces.create(html.replace('Hello', 'Second'))
    await workspaces.rename(second.id, 'Board plan')

    const secondPath = (await workspaces.get(second.id))?.path
    expect(path.basename(secondPath!)).toBe('Board plan 2.ark')
    await expect(access(secondPath!)).resolves.toBeUndefined()
    await expect(access(path.join(root, 'Board plan.ark'))).resolves.toBeUndefined()
  })

  it('keeps the current file when a new title maps onto its existing name', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const titled = await workspaces.rename(created.id, 'Q3: Review')
    expect(titled?.path).toBe(path.join(root, 'Q3 Review.ark'))

    const renamed = await workspaces.rename(created.id, 'Q3 Review')

    expect(renamed?.title).toBe('Q3 Review')
    expect(renamed?.path).toBe(titled?.path)
    await expect(access(path.join(root, 'Q3 Review 2.ark'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('keeps a user-chosen file name when the agent establishes the matching title', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const userPath = path.join(root, 'Board plan.ark')
    await workspaces.saveAs(created.id, userPath)

    const updated = await workspaces.updateDocument(
      created.id,
      html.replace('<title>Workspace</title>', '<title>Board plan</title>'),
      1,
    )

    expect(updated?.title).toBe('Board plan')
    expect(updated?.path).toBe(userPath)
    await expect(access(path.join(root, 'Board plan 2.ark'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('does not rewrite the recents index on an html-only document update', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const recentsPath = path.join(root, 'recent-workspaces.json')
    const before = await readFile(recentsPath, 'utf8')

    const updated = await workspaces.updateDocument(created.id, html.replace('Hello', 'Moved'), 1)

    expect(updated?.html).toContain('Moved')
    expect(updated?.documentRevision).toBe(2)
    expect(await readFile(recentsPath, 'utf8')).toBe(before)
    await expect(workspaces.listRecent()).resolves.toEqual([
      expect.objectContaining({ id: created.id, updatedAt: updated?.updatedAt }),
    ])
    await expect(workspaces.listDocumentHistory(created.id)).resolves.toEqual([
      expect.objectContaining({ revision: 1, source: 'create' }),
      expect.objectContaining({ revision: 2, source: 'editor' }),
    ])

    workspaces.close()
    store = createWorkspaceStore(root)
    await expect(store.listRecent()).resolves.toEqual([
      expect.objectContaining({ id: created.id, updatedAt: updated?.updatedAt }),
    ])
    await expect(store.get(created.id)).resolves.toMatchObject({
      html: expect.stringContaining('Moved'),
      documentRevision: 2,
    })
    await expect(store.listDocumentHistory(created.id)).resolves.toEqual([
      expect.objectContaining({ revision: 1, source: 'create' }),
      expect.objectContaining({ revision: 2, source: 'editor' }),
    ])
  })

  it('flushes recents on close for a workspace saved outside the managed directory', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'ark-outside-'))
    const outsidePath = path.join(outsideRoot, 'External.ark')

    try {
      const saved = await workspaces.move(created.id, outsidePath)
      if (!saved) throw new Error('expected move to return a workspace record')
      const recentsPath = path.join(root, 'recent-workspaces.json')
      const before = await readFile(recentsPath, 'utf8')

      const updated = await workspaces.updateDocument(
        saved.id,
        html.replace('Hello', 'Outside'),
        saved.documentRevision,
      )

      expect(updated?.path).toBe(outsidePath)
      expect(await readFile(recentsPath, 'utf8')).toBe(before)

      workspaces.close()
      store = createWorkspaceStore(root)
      await expect(store.listRecent()).resolves.toEqual([
        expect.objectContaining({
          id: saved.id,
          path: outsidePath,
          updatedAt: updated?.updatedAt,
        }),
      ])
    } finally {
      await rm(outsideRoot, { recursive: true, force: true })
    }
  })

  it('still persists recents when a document update changes the title', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const recentsPath = path.join(root, 'recent-workspaces.json')
    const before = await readFile(recentsPath, 'utf8')

    const updated = await workspaces.updateDocument(
      created.id,
      html.replace('<title>Workspace</title>', '<title>Board plan</title>'),
      1,
    )

    expect(updated?.title).toBe('Board plan')
    expect(await readFile(recentsPath, 'utf8')).not.toBe(before)
    await expect(workspaces.listRecent()).resolves.toEqual([
      expect.objectContaining({ id: created.id, title: 'Board plan', path: updated?.path }),
    ])
  })

  it('renames the managed file when an agent-established title changes', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const originalPath = created.path
    expect(path.basename(originalPath)).toBe('Workspace.ark')

    const updated = await workspaces.updateDocument(
      created.id,
      html.replace('<title>Workspace</title>', '<title>Board plan</title>'),
      1,
    )

    expect(updated).toMatchObject({ title: 'Board plan', documentRevision: 2 })
    expect(updated?.path).toBe(path.join(root, 'Board plan.ark'))
    await expect(access(originalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(updated!.path)).resolves.toBeUndefined()
    await expect(workspaces.get(created.id)).resolves.toMatchObject({ path: updated?.path })
    await expect(workspaces.listRecent()).resolves.toEqual([
      expect.objectContaining({ id: created.id, path: updated?.path }),
    ])
  })

  it('picks a collision-safe filename when an agent title collides with another file', async () => {
    const workspaces = await setup()
    const first = await workspaces.create(
      html.replace('<title>Workspace</title>', '<title>Board plan</title>'),
    )
    const second = await workspaces.create(html)
    expect(path.basename(second.path)).toBe('Workspace.ark')

    const retitled = await workspaces.updateDocument(
      second.id,
      html.replace('<title>Workspace</title>', '<title>Board plan</title>'),
      1,
    )

    expect(retitled?.title).toBe('Board plan')
    expect(retitled?.path).toBe(path.join(root, 'Board plan 2.ark'))
    await expect(access(first.path)).resolves.toBeUndefined()
    await expect(access(retitled!.path)).resolves.toBeUndefined()
  })

  it('lets an agent title change follow a UI rename once the document title is synced', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const renamed = await workspaces.rename(created.id, 'Board plan')
    expect(renamed?.path).toBe(path.join(root, 'Board plan.ark'))
    expect(renamed?.html).toContain('<title>Board plan</title>')

    const updated = await workspaces.updateDocument(
      created.id,
      html.replace('<title>Workspace</title>', '<title>Agent title</title>'),
      renamed!.documentRevision,
    )

    expect(updated?.title).toBe('Agent title')
    expect(updated?.path).toBe(path.join(root, 'Agent title.ark'))
  })

  it('renames a file on agent title change even after Save As picked the name', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const userPath = path.join(root, 'Custom name.ark')
    await workspaces.saveAs(created.id, userPath)

    const updated = await workspaces.updateDocument(
      created.id,
      html.replace('<title>Workspace</title>', '<title>Board plan</title>'),
      1,
    )

    expect(updated?.title).toBe('Board plan')
    expect(updated?.path).toBe(path.join(root, 'Board plan.ark'))
    await expect(access(userPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('renames a file opened from disk when the title changes', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    workspaces.close()

    store = createWorkspaceStore(root)
    await store.open(created.path)

    const updated = await store.updateDocument(
      created.id,
      html.replace('<title>Workspace</title>', '<title>Board plan</title>'),
      1,
    )

    expect(updated?.title).toBe('Board plan')
    expect(updated?.path).toBe(path.join(root, 'Board plan.ark'))
    await expect(access(created.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not bump the revision when a rename cannot sync the document title', async () => {
    const workspaces = await setup()
    const noTitleHtml = '<!DOCTYPE html><html><body><section class="slide"></section></body></html>'
    const created = await workspaces.create(noTitleHtml)

    const renamed = await workspaces.rename(created.id, 'Board plan')

    expect(renamed?.title).toBe('Board plan')
    expect(renamed?.html).toBe(noTitleHtml)
    expect(renamed?.documentRevision).toBe(1)
    await expect(workspaces.listDocumentHistory(created.id)).resolves.toEqual([
      expect.objectContaining({ revision: 1, source: 'create' }),
    ])
  })

  it('adopts an externally renamed file name as the deck title on open', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    expect(created.title).toBe('Workspace')
    workspaces.close()

    const renamedPath = path.join(root, 'Final.ark')
    await rename(created.path, renamedPath)

    store = createWorkspaceStore(root)
    const opened = await store.open(renamedPath)

    expect(opened?.title).toBe('Final')
    expect(opened?.path).toBe(renamedPath)
    expect(opened?.html).toContain('<title>Final</title>')
    expect(opened?.documentRevision).toBe(2)
    await expect(store.listDocumentHistory(created.id)).resolves.toEqual([
      expect.objectContaining({ revision: 1, source: 'create' }),
      expect.objectContaining({ revision: 2, source: 'editor' }),
    ])
    await expect(store.listRecent()).resolves.toEqual([
      expect.objectContaining({ id: created.id, title: 'Final', path: renamedPath }),
    ])
  })

  it('does not adopt a collision-safe suffix as the deck title on open', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    workspaces.close()

    const suffixedPath = path.join(root, 'Workspace 2.ark')
    await rename(created.path, suffixedPath)

    store = createWorkspaceStore(root)
    await expect(store.open(suffixedPath)).resolves.toMatchObject({
      title: 'Workspace',
      path: suffixedPath,
    })
  })

  it('adopts the file name as the deck title when locating a missing workspace', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    workspaces.close()

    const relocatedPath = path.join(root, 'Relocated.ark')
    await rename(created.path, relocatedPath)

    store = createWorkspaceStore(root)
    const located = await store.locate(created.id, relocatedPath)

    expect(located?.title).toBe('Relocated')
    expect(located?.path).toBe(relocatedPath)
  })

  it('keeps the stored title when opening a file whose name still matches', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    workspaces.close()

    store = createWorkspaceStore(root)
    await expect(store.open(created.path)).resolves.toMatchObject({
      title: 'Workspace',
      path: created.path,
    })
  })

  it('overwrites an existing file on Save As only when explicitly allowed', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const targetPath = path.join(root, 'Taken.ark')
    await writeFile(targetPath, 'keep this', 'utf8')

    await expect(workspaces.saveAs(created.id, targetPath)).rejects.toThrow('already exists')
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('keep this')

    const saved = await workspaces.saveAs(created.id, targetPath, true)

    expect(saved?.path).toBe(targetPath)
    await expect(workspaces.open(targetPath)).resolves.toMatchObject({ id: created.id })
  })

  it('overwrites an existing file on Move only when explicitly allowed', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const targetPath = path.join(root, 'Taken.ark')
    await writeFile(targetPath, 'keep this', 'utf8')
    const originalPath = created.path

    await expect(workspaces.move(created.id, targetPath)).rejects.toThrow('already exists')
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('keep this')

    const moved = await workspaces.move(created.id, targetPath, true)

    expect(moved?.path).toBe(targetPath)
    await expect(access(originalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(workspaces.open(targetPath)).resolves.toMatchObject({ id: created.id })
  })

  it('overwrites an existing file when duplicating into an explicit path', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const targetPath = path.join(root, 'Taken.ark')
    await writeFile(targetPath, 'not a workspace', 'utf8')

    await expect(workspaces.duplicate(created.id, 'complete', targetPath)).rejects.toThrow(
      'already exists',
    )
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('not a workspace')

    const copy = await workspaces.duplicate(created.id, 'complete', targetPath, undefined, true)

    expect(copy?.path).toBe(targetPath)
    await expect(workspaces.open(targetPath)).resolves.toMatchObject({
      id: copy?.id,
      html: expect.stringContaining('Hello'),
    })
  })

  it('drops the overwritten workspace from the recent list', async () => {
    const workspaces = await setup()
    const doomed = await workspaces.create(html.replace('Hello', 'Doomed'), undefined, undefined)
    const created = await workspaces.create(html)
    const targetPath = doomed.path
    workspaces.close()

    store = createWorkspaceStore(root)
    await store.open(created.path)
    const saved = await store.saveAs(created.id, targetPath, true)

    expect(saved?.path).toBe(targetPath)
    await expect(store.listRecent()).resolves.toEqual([
      expect.objectContaining({ id: created.id, path: targetPath }),
    ])
  })

  it('renames the file in place when renaming outside the default directory', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const externalDir = await mkdtemp(path.join(os.tmpdir(), 'ark-external-'))
    try {
      const externalPath = path.join(externalDir, 'My chosen name.ark')
      await workspaces.move(created.id, externalPath)

      const renamed = await workspaces.rename(created.id, 'Board plan')

      expect(renamed?.title).toBe('Board plan')
      expect(renamed?.path).toBe(path.join(externalDir, 'Board plan.ark'))
      await expect(access(externalPath)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(renamed!.path)).resolves.toBeUndefined()
    } finally {
      await rm(externalDir, { recursive: true, force: true })
    }
  })

  it('supports Save As and Move without overwriting another file', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const originalPath = created.path
    const occupiedSavePath = path.join(root, 'Occupied save.ark')
    await writeFile(occupiedSavePath, 'keep this too', 'utf8')
    await expect(workspaces.saveAs(created.id, occupiedSavePath)).rejects.toThrow('already exists')
    await expect(readFile(occupiedSavePath, 'utf8')).resolves.toBe('keep this too')

    const savedPath = path.join(root, 'Saved copy.ark')
    const saved = await workspaces.saveAs(created.id, savedPath)

    expect(saved?.path).toBe(savedPath)
    await expect(access(originalPath)).resolves.toBeUndefined()
    await expect(access(savedPath)).resolves.toBeUndefined()

    const occupiedPath = path.join(root, 'Occupied.ark')
    await writeFile(occupiedPath, 'keep me', 'utf8')
    await expect(workspaces.move(created.id, occupiedPath)).rejects.toThrow('already exists')
    await expect(readFile(occupiedPath, 'utf8')).resolves.toBe('keep me')

    const movedPath = path.join(root, 'Moved.ark')
    await expect(workspaces.move(created.id, movedPath)).resolves.toMatchObject({ path: movedPath })
    await expect(access(savedPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('lists recent metadata without opening or reading presentation HTML', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    workspaces.close()

    const database = new DatabaseSync(created.path)
    database.prepare('DELETE FROM document').run()
    database.close()

    store = createWorkspaceStore(root)
    await expect(store.listRecent()).resolves.toEqual([
      expect.objectContaining({ id: created.id, missing: false }),
    ])
  })

  it.each(['deleted', 'corrupted'] as const)(
    'treats externally %s recent workspaces as missing',
    async (state) => {
      const workspaces = await setup()
      const created = await workspaces.create(html)
      workspaces.close()

      if (state === 'deleted') {
        await rm(created.path)
      } else {
        await writeFile(created.path, 'not a workspace', 'utf8')
      }

      store = createWorkspaceStore(root)
      await expect(store.get(created.id)).resolves.toBeNull()
      await expect(store.database(created.id)).resolves.toBeNull()
    },
  )

  it('does not close another live workspace when Locate selects the wrong file', async () => {
    const workspaces = await setup()
    const first = await workspaces.create(html.replace('Workspace', 'First'))
    const second = await workspaces.create(html.replace('Workspace', 'Second'))

    await expect(workspaces.locate(first.id, second.path)).rejects.toThrow('different identity')
    await expect(workspaces.get(second.id)).resolves.toMatchObject({ id: second.id })
  })

  it('explains duplicate workspace identities for manually copied files', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const copiedPath = path.join(root, 'Manual copy.ark')
    await copyFile(created.path, copiedPath)

    await expect(workspaces.open(copiedPath)).rejects.toThrow(created.path)
  })

  it('keeps a persist rollback journal only while the workspace is open', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    await workspaces.updateDocument(created.id, html.replace('Hello', 'Edited'), 1)

    const journalPath = `${created.path}-journal`
    await expect(access(journalPath)).resolves.toBeUndefined()

    const database = await workspaces.database(created.id)
    expect(database?.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'persist' })

    workspaces.close()
    await expect(access(journalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('still closes every workspace if the rollback journal cannot be unlinked', async () => {
    const workspaces = await setup()
    const first = await workspaces.create(html)
    const second = await workspaces.create(html.replace('Hello', 'Second'))
    await workspaces.updateDocument(first.id, html.replace('Hello', 'Edited'), 1)

    const journalPath = `${first.path}-journal`
    await rm(journalPath)
    await mkdir(journalPath)
    await writeFile(path.join(journalPath, 'blocker'), 'blocked')

    expect(() => workspaces.close()).not.toThrow()

    store = createWorkspaceStore(root)
    await expect(store.get(second.id)).resolves.toMatchObject({
      html: expect.stringContaining('Second'),
    })

    await rm(journalPath, { recursive: true, force: true })
    await expect(store.get(first.id)).resolves.toMatchObject({
      html: expect.stringContaining('Edited'),
    })
  })

  it('garbage-collects document-orphaned assets and blobs on save', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const assets = createAssetStore(workspaces)
    const kept = await assets.createAsset({
      deckId: created.id,
      filename: 'kept.png',
      mediaType: 'image/png',
      category: 'image',
      source: 'upload',
      bytes: Buffer.from('kept'),
    })
    await assets.createAsset({
      deckId: created.id,
      filename: 'orphan.png',
      mediaType: 'image/png',
      category: 'image',
      source: 'upload',
      bytes: Buffer.from('orphan'),
    })
    const database = await workspaces.database(created.id)
    database?.prepare('UPDATE assets SET created_at = ?').run('2020-01-01T00:00:00.000Z')

    await workspaces.updateDocument(
      created.id,
      html.replace('</body>', `<img src="ark-asset:${kept.id}"></body>`),
      1,
    )
    await expect(assets.listAssetsByDeck(created.id)).resolves.toEqual([
      expect.objectContaining({ id: kept.id }),
    ])

    await workspaces.updateDocument(created.id, html, 2)
    await expect(assets.listAssetsByDeck(created.id)).resolves.toEqual([
      expect.objectContaining({ id: kept.id }),
    ])

    evictDocumentHistory(database!, { maxEntries: 1, maxBytes: 8 * 1024 * 1024 })
    garbageCollectUnreferencedAssets(database!)
    await expect(assets.listAssetsByDeck(created.id)).resolves.toEqual([])
    expect(database?.prepare('SELECT COUNT(*) AS count FROM blobs').get()).toEqual({ count: 0 })
  })

  it('keeps fresh unreferenced attachments through a concurrent document save', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const assets = createAssetStore(workspaces)
    const chat = createChatStore(workspaces)
    const attachment = await assets.createAsset({
      deckId: created.id,
      filename: 'prompt.csv',
      mediaType: 'text/csv',
      category: 'text',
      source: 'upload',
      bytes: Buffer.from('quarter,revenue'),
    })

    await workspaces.updateDocument(created.id, html, 1)
    await expect(
      chat.appendMessage(created.id, {
        role: 'user',
        content: 'Start a deck from this CSV',
        attachments: [
          {
            type: 'file',
            mediaType: attachment.mediaType,
            filename: attachment.filename,
            url: `ark-asset:${attachment.id}`,
            assetId: attachment.id,
          },
        ],
      }),
    ).resolves.toMatchObject({ content: 'Start a deck from this CSV' })
  })

  it('prunes stale thumbnails and does not copy thumbnail history', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const thumbnail = {
      mediaType: 'image/png',
      width: 480,
      height: 270,
      image: Buffer.from('png'),
    }
    await workspaces.writeThumbnail(created.id, {
      ...thumbnail,
      slideHash: 'current',
      rendererVersion: 'renderer-2',
      manifestHash: 'manifest-2',
    })
    await workspaces.writeThumbnail(created.id, {
      ...thumbnail,
      slideHash: 'stale-slide',
      rendererVersion: 'renderer-2',
      manifestHash: 'manifest-2',
    })
    await workspaces.writeThumbnail(created.id, {
      ...thumbnail,
      slideHash: 'old-renderer',
      rendererVersion: 'renderer-1',
      manifestHash: 'manifest-1',
    })

    await workspaces.pruneThumbnails(created.id, ['current'], 'renderer-2', 'manifest-2')
    const sourceDatabase = await workspaces.database(created.id)
    expect(sourceDatabase?.prepare('SELECT slide_hash FROM thumbnails').all()).toEqual([
      { slide_hash: 'current' },
    ])

    const copy = await workspaces.duplicate(created.id, 'presentation')
    const copyDatabase = await workspaces.database(copy!.id)
    expect(copyDatabase?.prepare('SELECT COUNT(*) AS count FROM thumbnails').get()).toEqual({
      count: 0,
    })
  })

  it('caches the current cover in the disposable recent index', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    await workspaces.writeThumbnail(created.id, {
      slideHash: 'slide',
      rendererVersion: 'renderer',
      manifestHash: 'manifest',
      mediaType: 'image/png',
      width: 480,
      height: 270,
      image: Buffer.from('png'),
      cover: true,
    })

    expect(await workspaces.listRecent()).toEqual([
      expect.objectContaining({ cover: 'data:image/png;base64,cG5n' }),
    ])
  })

  it('duplicates only document assets and selected conversation content', async () => {
    const workspaces = await setup()
    const source = await workspaces.create(html)
    const assets = createAssetStore(workspaces)
    const chat = createChatStore(workspaces)

    const documentAsset = await assets.createAsset({
      deckId: source.id,
      filename: 'chart.png',
      mediaType: 'image/png',
      category: 'image',
      source: 'upload',
      bytes: Buffer.from('chart'),
    })
    await assets.addReference(source.id, documentAsset.id, 'document', '1', 'embedded')

    const selectedThread = await chat.createThread(source.id, 'Selected')
    const selectedMessage = await chat.appendMessage(source.id, {
      role: 'user',
      content: 'Selected source',
    })
    const selectedAsset = await assets.createAsset({
      deckId: source.id,
      chatMessageId: selectedMessage.id,
      filename: 'selected.txt',
      mediaType: 'text/plain',
      category: 'text',
      source: 'upload',
      bytes: Buffer.from('selected'),
    })

    await chat.updateThread(source.id, selectedThread.id, { archived: true })
    await chat.createThread(source.id, 'Excluded')
    const excludedMessage = await chat.appendMessage(source.id, {
      role: 'user',
      content: 'Excluded source',
    })
    const excludedAsset = await assets.createAsset({
      deckId: source.id,
      chatMessageId: excludedMessage.id,
      filename: 'excluded.txt',
      mediaType: 'text/plain',
      category: 'text',
      source: 'upload',
      bytes: Buffer.from('excluded'),
    })

    const copy = await workspaces.duplicate(source.id, 'complete', undefined, [selectedThread.id])
    expect(copy).not.toBeNull()
    const copiedAssets = await assets.listAssetsByDeck(copy!.id)
    expect(copiedAssets.map((asset) => asset.id)).toEqual(
      expect.arrayContaining([documentAsset.id, selectedAsset.id]),
    )
    expect(copiedAssets.map((asset) => asset.id)).not.toContain(excludedAsset.id)
    await expect(chat.listThreads(copy!.id)).resolves.toEqual([
      expect.objectContaining({ title: 'Selected' }),
    ])
  })
})

function readHistoryFromFile(filePath: string) {
  const database = new DatabaseSync(filePath, { readOnly: true })
  try {
    return database
      .prepare(
        'SELECT revision, source, html, byte_size FROM document_history ORDER BY revision ASC',
      )
      .all() as Array<{ revision: number; source: string; html: string; byte_size: number }>
  } finally {
    database.close()
  }
}

describe('WorkspaceStore document history', () => {
  let root = ''
  let store: WorkspaceStore | null = null

  afterEach(async () => {
    store?.close()
    store = null
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  async function setup() {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-history-'))
    store = createWorkspaceStore(root)
    return store
  }

  it('persists committed snapshots in the .ark file and reloads them', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const edited = html.replace('Hello', 'Edited')
    const generated = html.replace('Hello', 'Generated')
    await workspaces.updateDocument(created.id, edited, 1, [], 'editor')
    await workspaces.updateDocument(created.id, generated, 2, [], 'agent')
    await workspaces.updateDocument(created.id, generated, 3, [], 'editor')
    await workspaces.updateDocument(created.id, html.replace('Hello', 'MCP'), 4, [], 'mcp')
    await workspaces.updateDocument(created.id, html.replace('Hello', 'Import'), 5, [], 'import')

    workspaces.close()
    const onDisk = readHistoryFromFile(created.path)
    expect(onDisk.map((row) => ({ revision: row.revision, source: row.source }))).toEqual([
      { revision: 1, source: 'create' },
      { revision: 2, source: 'editor' },
      { revision: 3, source: 'agent' },
      { revision: 5, source: 'mcp' },
      { revision: 6, source: 'import' },
    ])
    expect(onDisk.some((row) => row.html.includes('Generated'))).toBe(true)
    expect(onDisk[2]?.html).not.toContain('sk-test')

    store = createWorkspaceStore(root)
    await expect(store.listDocumentHistory(created.id)).resolves.toEqual([
      expect.objectContaining({ revision: 1, source: 'create' }),
      expect.objectContaining({ revision: 2, source: 'editor' }),
      expect.objectContaining({ revision: 3, source: 'agent' }),
      expect.objectContaining({ revision: 5, source: 'mcp' }),
      expect.objectContaining({ revision: 6, source: 'import' }),
    ])
  })

  it('adds document_history on open for files written before the table', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    workspaces.close()

    const database = new DatabaseSync(created.path)
    database.exec('DROP TABLE document_history')
    database.close()

    store = createWorkspaceStore(root)
    await store.open(created.path)
    await expect(store.listDocumentHistory(created.id)).resolves.toEqual([
      expect.objectContaining({ revision: 1, source: 'create' }),
    ])
    expect(readHistoryFromFile(created.path)[0]?.html).toContain('Hello')

    const migrated = new DatabaseSync(created.path, { readOnly: true })
    try {
      expect(migrated.prepare('SELECT format_version FROM workspace').get()).toEqual({
        format_version: 1,
      })
      expect(migrated.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    } finally {
      migrated.close()
    }
  })

  it('evicts the oldest snapshots once the entry cap is exceeded', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)

    for (let index = 0; index < DOCUMENT_HISTORY_MAX_ENTRIES; index += 1) {
      const next = html.replace('Hello', `V${index}`)
      await workspaces.updateDocument(created.id, next, index + 1, [], 'editor')
    }

    const history = await workspaces.listDocumentHistory(created.id)
    expect(history).toHaveLength(DOCUMENT_HISTORY_MAX_ENTRIES)
    expect(history?.[0]?.revision).toBe(2)
    expect(readHistoryFromFile(created.path)).toHaveLength(DOCUMENT_HISTORY_MAX_ENTRIES)
    expect(readHistoryFromFile(created.path).some((row) => row.html.includes('Hello</h1>'))).toBe(
      false,
    )
  })

  it('evicts the oldest snapshots once stored HTML exceeds 8 MiB', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const payload = (label: string) =>
      `<!DOCTYPE html><html><head><title>Workspace</title></head><body><section class="slide"><h1>${label}${'x'.repeat(5 * 1024 * 1024)}</h1></section></body></html>`

    await workspaces.updateDocument(created.id, payload('A'), 1, [], 'editor')
    await workspaces.updateDocument(created.id, payload('B'), 2, [], 'editor')

    const history = await workspaces.listDocumentHistory(created.id)
    expect(history).toEqual([expect.objectContaining({ revision: 3, source: 'editor' })])
    workspaces.close()
    const onDisk = readHistoryFromFile(created.path)
    expect(onDisk).toHaveLength(1)
    expect(onDisk[0]).toEqual(
      expect.objectContaining({ revision: 3, html: expect.stringContaining('<h1>B') }),
    )
    expect(onDisk.reduce((sum, row) => sum + row.byte_size, 0)).toBeLessThanOrEqual(
      DOCUMENT_HISTORY_MAX_BYTES,
    )
  })

  it('restores a history row and still conflict-detects via document_revision', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const edited = html.replace('Hello', 'Edited')
    await workspaces.updateDocument(created.id, edited, 1, [], 'editor')

    await expect(workspaces.restoreDocument(created.id, 1, 1)).rejects.toMatchObject({
      code: 'document_conflict',
      currentDocumentRevision: 2,
    })

    const restored = await workspaces.restoreDocument(created.id, 1, 2)
    expect(restored).toMatchObject({
      documentRevision: 3,
      html: expect.stringContaining('Hello'),
    })
    await expect(workspaces.listDocumentHistory(created.id)).resolves.toEqual([
      expect.objectContaining({ revision: 1, source: 'create' }),
      expect.objectContaining({ revision: 2, source: 'editor' }),
      expect.objectContaining({ revision: 3, source: 'restore' }),
    ])

    const sameHtml = await workspaces.restoreDocument(created.id, 1, 3)
    expect(sameHtml).toMatchObject({
      documentRevision: 4,
      html: expect.stringContaining('Hello'),
    })
    await expect(workspaces.listDocumentHistory(created.id)).resolves.toEqual([
      expect.objectContaining({ revision: 1, source: 'create' }),
      expect.objectContaining({ revision: 2, source: 'editor' }),
      expect.objectContaining({ revision: 3, source: 'restore' }),
    ])

    await expect(
      workspaces.updateDocument(created.id, html.replace('Hello', 'Stale'), 2),
    ).rejects.toMatchObject({ code: 'document_conflict', currentDocumentRevision: 4 })

    workspaces.close()
    store = createWorkspaceStore(root)
    await expect(store.open(created.path)).resolves.toMatchObject({
      documentRevision: 4,
      html: expect.stringContaining('Hello'),
    })
  })

  it('copies history with the .ark file and starts Duplicate from the current document only', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    await workspaces.updateDocument(created.id, html.replace('Hello', 'Edited'), 1, [], 'editor')
    const sourcePath = created.path

    const copy = await workspaces.duplicate(created.id, 'presentation')
    expect(copy!.id).not.toBe(created.id)
    const copyHistory = readHistoryFromFile(copy!.path)
    expect(copyHistory).toEqual([
      expect.objectContaining({
        revision: 1,
        source: 'create',
        html: expect.stringContaining('Edited'),
      }),
    ])

    // Save As uses sqlite backup() (Node 24 / Electron). journal_mode=PERSIST
    // still commits into the main file (not WAL), so a closed-file copy is the
    // complete database, including document_history. The leftover rollback
    // journal is invalidated and removed when the connection closes.
    workspaces.close()
    const savedPath = path.join(root, 'Saved.ark')
    await copyFile(sourcePath, savedPath)
    expect(readHistoryFromFile(savedPath).map((row) => row.source)).toEqual(['create', 'editor'])

    store = createWorkspaceStore(root)
    const reopened = await store.open(savedPath)
    await expect(store.listDocumentHistory(reopened.id)).resolves.toEqual([
      expect.objectContaining({ revision: 1, source: 'create' }),
      expect.objectContaining({ revision: 2, source: 'editor' }),
      expect.objectContaining({ revision: 3, source: 'editor' }),
    ])
    expect(reopened.html).toContain('<title>Saved</title>')

    const sqlite = await import('node:sqlite')
    if (typeof sqlite.backup === 'function') {
      const viaBackup = path.join(root, 'BackedUp.ark')
      const saved = await store.saveAs(reopened.id, viaBackup)
      expect(saved!.id).toBe(reopened.id)
      expect(readHistoryFromFile(saved!.path).map((row) => row.source)).toEqual([
        'create',
        'editor',
        'editor',
      ])
    }
  })

  it('never writes generation-job payloads or extra secret tables into history', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const jobs = createGenerationJobStore()
    await jobs.createJob({
      deckId: created.id,
      model: 'openai:gpt-5.6-luna',
      request: {
        messages: [{ role: 'user', content: 'sk-live-not-for-history' }],
        currentHtml: html.replace('Hello', 'JOB_PAYLOAD'),
        editingExistingDeck: true,
        reasoningEffort: 'high',
      },
    })
    await workspaces.updateDocument(created.id, html.replace('Hello', 'Agent'), 1, [], 'agent')

    const database = new DatabaseSync(created.path, { readOnly: true })
    try {
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
      expect(tables.map((row) => row.name)).not.toContain('generation_jobs')
      const historyHtml = database.prepare('SELECT html FROM document_history').all() as Array<{
        html: string
      }>
      expect(historyHtml.some((row) => row.html.includes('JOB_PAYLOAD'))).toBe(false)
      expect(historyHtml.some((row) => row.html.includes('sk-live-not-for-history'))).toBe(false)
      const columns = database.prepare('PRAGMA table_info(document_history)').all() as Array<{
        name: string
      }>
      expect(columns.map((column) => column.name).sort()).toEqual([
        'byte_size',
        'created_at',
        'html',
        'revision',
        'source',
      ])
    } finally {
      database.close()
    }
  })

  it('keeps history-referenced assets through GC so restore can still load them', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const assets = createAssetStore(workspaces)
    const imageA = await assets.createAsset({
      deckId: created.id,
      filename: 'a.png',
      mediaType: 'image/png',
      category: 'image',
      source: 'upload',
      bytes: Buffer.from('image-a-bytes'),
    })
    const htmlA = html.replace('</body>', `<img src="ark-asset:${imageA.id}" alt="A"></body>`)
    await workspaces.updateDocument(created.id, htmlA, 1)

    const imageB = await assets.createAsset({
      deckId: created.id,
      filename: 'b.png',
      mediaType: 'image/png',
      category: 'image',
      source: 'upload',
      bytes: Buffer.from('image-b-bytes'),
    })
    const htmlB = html.replace('</body>', `<img src="ark-asset:${imageB.id}" alt="B"></body>`)
    await workspaces.updateDocument(created.id, htmlB, 2)

    const database = await workspaces.database(created.id)
    database?.prepare('UPDATE assets SET created_at = ?').run('2020-01-01T00:00:00.000Z')
    // Identical save still runs GC; A is only in history, not the live document.
    await workspaces.updateDocument(created.id, htmlB, 3)

    await expect(assets.readBytes(created.id, imageA.id)).resolves.toEqual(
      Buffer.from('image-a-bytes'),
    )

    const restored = await workspaces.restoreDocument(created.id, 2, 4)
    expect(restored?.html).toContain(`ark-asset:${imageA.id}`)
    await expect(assets.readBytes(created.id, imageA.id)).resolves.toEqual(
      Buffer.from('image-a-bytes'),
    )

    await workspaces.updateDocument(created.id, html, restored!.documentRevision)
    evictDocumentHistory(database!, { maxEntries: 1, maxBytes: 8 * 1024 * 1024 })
    garbageCollectUnreferencedAssets(database!)
    await expect(assets.getAsset(created.id, imageA.id)).resolves.toBeNull()
    await expect(assets.readBytes(created.id, imageA.id)).resolves.toBeNull()
  })

  it('restores a renamed title from history instead of silently reverting it', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const renamed = await workspaces.rename(created.id, 'Board plan')
    expect(renamed?.html).toContain('<title>Board plan</title>')
    await expect(workspaces.listDocumentHistory(created.id)).resolves.toEqual([
      expect.objectContaining({ revision: 1, source: 'create' }),
      expect.objectContaining({ revision: 2, source: 'editor' }),
    ])

    const beforeRename = await workspaces.restoreDocument(created.id, 1, 2)
    expect(beforeRename?.html).toContain('<title>Workspace</title>')

    const afterRename = await workspaces.restoreDocument(
      created.id,
      2,
      beforeRename!.documentRevision,
    )
    expect(afterRename?.html).toContain('<title>Board plan</title>')
  })

  it('keeps the deck name and the .ark file name when restoring older HTML', async () => {
    // A content rollback is not a rename: the snapshot's older <title> must not
    // move the file on disk out from under the user.
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const renamed = await workspaces.rename(created.id, 'Board plan')
    expect(path.basename(renamed!.path)).toBe('Board plan.ark')

    const restored = await workspaces.restoreDocument(created.id, 1, renamed!.documentRevision)

    expect(restored?.html).toContain('<title>Workspace</title>')
    expect(restored?.title).toBe('Board plan')
    expect(restored?.path).toBe(renamed!.path)
    await expect(access(renamed!.path)).resolves.toBeUndefined()
  })

  it('keeps the renamed file when appending its history row fails', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const database = await workspaces.database(created.id)
    // Occupy the revision the rename will append at, so the history INSERT
    // fails on the primary key after the file has already moved.
    database!
      .prepare(
        `INSERT INTO document_history (revision, html, source, created_at, byte_size)
         VALUES (2, 'squatter', 'editor', '2026-09-01T00:00:00.000Z', 9)`,
      )
      .run()

    await expect(workspaces.rename(created.id, 'Board plan')).rejects.toThrow()

    // The rename-rollback must not run past the file move: reopening the old
    // path would leave a stray empty database there and mask this error.
    const renamedPath = path.join(path.dirname(created.path), 'Board plan.ark')
    await expect(access(renamedPath)).resolves.toBeUndefined()
    await expect(access(created.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
