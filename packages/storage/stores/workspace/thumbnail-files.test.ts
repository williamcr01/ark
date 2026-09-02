import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { RecentList } from './recent-list.ts'
import { SCHEMA, configure } from './schema.ts'
import { ThumbnailFiles } from './thumbnail-files.ts'
import type { WorkspaceRow } from './types.ts'

const id = '00000000-0000-4000-8000-000000000001'

const png = Buffer.from('png')

function memoryThumbnails(recents: RecentList) {
  const database = new DatabaseSync(':memory:')
  configure(database)
  database.exec(SCHEMA)
  return {
    database,
    thumbnails: new ThumbnailFiles(async () => database, recents),
  }
}

describe('ThumbnailFiles', () => {
  let root = ''
  let database: DatabaseSync | null = null

  afterEach(async () => {
    database?.close()
    database = null
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  async function setup() {
    root = await mkdtemp(path.join(os.tmpdir(), 'ark-thumbnails-'))
    const recents = new RecentList(path.join(root, 'recent-workspaces.json'))
    recents.remember({
      id,
      title: 'Workspace',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      documentRevision: 1,
      origin: 'authored',
      html: '<html></html>',
      path: path.join(root, 'Workspace.ark'),
    } satisfies WorkspaceRow)
    const created = memoryThumbnails(recents)
    database = created.database
    return { recents, thumbnails: created.thumbnails }
  }

  it('returns null when the workspace database is missing', async () => {
    const recents = new RecentList(path.join(os.tmpdir(), 'unused-recent.json'))
    const thumbnails = new ThumbnailFiles(async () => null, recents)
    await expect(thumbnails.readThumbnail(id, 'slide', 'r', 'm')).resolves.toBeNull()
    await expect(
      thumbnails.writeThumbnail(id, {
        slideHash: 'slide',
        rendererVersion: 'r',
        manifestHash: 'm',
        mediaType: 'image/png',
        width: 1,
        height: 1,
        image: png,
      }),
    ).resolves.toBe(false)
    await expect(thumbnails.pruneThumbnails(id, ['slide'], 'r', 'm')).resolves.toBe(false)
  })

  it('writes, reads, and upserts a thumbnail row', async () => {
    const { thumbnails } = await setup()
    await expect(
      thumbnails.writeThumbnail(id, {
        slideHash: 'slide',
        rendererVersion: 'renderer-2',
        manifestHash: 'manifest-2',
        mediaType: 'image/png',
        width: 480,
        height: 270,
        image: png,
      }),
    ).resolves.toBe(true)

    await expect(
      thumbnails.readThumbnail(id, 'slide', 'renderer-2', 'manifest-2'),
    ).resolves.toEqual({
      mediaType: 'image/png',
      width: 480,
      height: 270,
      image: png,
    })

    const updated = Buffer.from('png2')
    await thumbnails.writeThumbnail(id, {
      slideHash: 'slide',
      rendererVersion: 'renderer-2',
      manifestHash: 'manifest-2',
      mediaType: 'image/png',
      width: 960,
      height: 540,
      image: updated,
    })
    await expect(
      thumbnails.readThumbnail(id, 'slide', 'renderer-2', 'manifest-2'),
    ).resolves.toEqual({
      mediaType: 'image/png',
      width: 960,
      height: 540,
      image: updated,
    })
  })

  it('prunes stale hashes and clears the table when given none', async () => {
    const { thumbnails } = await setup()
    const base = {
      mediaType: 'image/png',
      width: 480,
      height: 270,
      image: png,
    }
    await thumbnails.writeThumbnail(id, {
      ...base,
      slideHash: 'current',
      rendererVersion: 'renderer-2',
      manifestHash: 'manifest-2',
    })
    await thumbnails.writeThumbnail(id, {
      ...base,
      slideHash: 'stale-slide',
      rendererVersion: 'renderer-2',
      manifestHash: 'manifest-2',
    })
    await thumbnails.writeThumbnail(id, {
      ...base,
      slideHash: 'old-renderer',
      rendererVersion: 'renderer-1',
      manifestHash: 'manifest-1',
    })

    await thumbnails.pruneThumbnails(id, ['current'], 'renderer-2', 'manifest-2')
    expect(database?.prepare('SELECT slide_hash FROM thumbnails').all()).toEqual([
      { slide_hash: 'current' },
    ])

    await thumbnails.pruneThumbnails(id, [], 'renderer-2', 'manifest-2')
    expect(database?.prepare('SELECT COUNT(*) AS count FROM thumbnails').get()).toEqual({
      count: 0,
    })
  })

  it('stores a cover data URL on the recent row', async () => {
    const { recents, thumbnails } = await setup()
    await thumbnails.writeThumbnail(id, {
      slideHash: 'slide',
      rendererVersion: 'renderer',
      manifestHash: 'manifest',
      mediaType: 'image/png',
      width: 480,
      height: 270,
      image: png,
      cover: true,
    })
    expect(recents.get(id)?.cover).toBe('data:image/png;base64,cG5n')
  })
})
