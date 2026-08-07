import { access, copyFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { createAssetStore } from './asset-store.ts'
import { createChatStore } from './chat-store.ts'
import { createWorkspaceStore, type WorkspaceStore } from './workspace-store.ts'

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

    // Autosaving identical HTML is not authoring.
    const resaved = await workspaces.updateDocument(created.id, blank, 1)
    expect(resaved?.origin).toBe('blank')

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

  it('renames the on-disk file to match a new title in the default directory', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const originalPath = created.path
    expect(path.basename(originalPath)).toBe('Workspace.ark')

    const renamed = await workspaces.rename(created.id, 'Board plan')

    expect(renamed?.title).toBe('Board plan')
    expect(renamed?.path).toBe(path.join(root, 'Board plan.ark'))
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

  it('keeps the file name when an explicit UI rename blocks agent title adoption', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    await workspaces.rename(created.id, 'Board plan')
    const renamedPath = (await workspaces.get(created.id))?.path

    const updated = await workspaces.updateDocument(
      created.id,
      html.replace('<title>Workspace</title>', '<title>Agent title</title>'),
      1,
    )

    expect(updated?.title).toBe('Board plan')
    expect(updated?.path).toBe(renamedPath)
  })

  it('does not rename a user-placed file in the default directory', async () => {
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
    expect(updated?.path).toBe(userPath)
    await expect(access(userPath)).resolves.toBeUndefined()
  })

  it('does not rename a file opened from disk even when the title changes', async () => {
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
    expect(updated?.path).toBe(created.path)
  })

  it('defaults legacy files without a name_source column to derived names', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    workspaces.close()

    const database = new DatabaseSync(created.path)
    database.exec('ALTER TABLE workspace DROP COLUMN name_source')
    database.close()

    store = createWorkspaceStore(root)
    // Boot/scan path: the deck is reopened from the recent index, not via the
    // open dialog, so its name stays Ark-derived.
    await expect(store.get(created.id)).resolves.toMatchObject({ path: created.path })

    const updated = await store.updateDocument(
      created.id,
      html.replace('<title>Workspace</title>', '<title>Board plan</title>'),
      1,
    )

    expect(updated?.title).toBe('Board plan')
    expect(updated?.path).toBe(path.join(root, 'Board plan.ark'))
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

  it('keeps a user-chosen path name when renaming outside the default directory', async () => {
    const workspaces = await setup()
    const created = await workspaces.create(html)
    const externalDir = await mkdtemp(path.join(os.tmpdir(), 'ark-external-'))
    try {
      const externalPath = path.join(externalDir, 'My chosen name.ark')
      await workspaces.move(created.id, externalPath)

      const renamed = await workspaces.rename(created.id, 'Board plan')

      expect(renamed?.title).toBe('Board plan')
      expect(renamed?.path).toBe(externalPath)
      await expect(access(externalPath)).resolves.toBeUndefined()
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
