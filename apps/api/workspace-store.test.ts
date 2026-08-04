import { access, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

    await workspaces.updateDocument(
      created.id,
      html.replace('</body>', `<img src="ark-asset:${kept.id}"></body>`),
    )
    await expect(assets.listAssetsByDeck(created.id)).resolves.toEqual([
      expect.objectContaining({ id: kept.id }),
    ])

    await workspaces.updateDocument(created.id, html)
    await expect(assets.listAssetsByDeck(created.id)).resolves.toEqual([])
    const database = await workspaces.database(created.id)
    expect(database?.prepare('SELECT COUNT(*) AS count FROM blobs').get()).toEqual({ count: 0 })
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
