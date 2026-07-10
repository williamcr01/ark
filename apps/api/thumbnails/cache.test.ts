import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildThumbnailCacheKey,
  buildThumbnailManifestFingerprint,
  buildThumbnailSlideUrl,
  createThumbnailCache,
  type ThumbnailCacheOptions,
} from './cache.ts'
import { THUMBNAIL_STATUS } from './constants.ts'

describe('thumbnail cache', () => {
  let cacheDir = ''

  afterEach(async () => {
    if (cacheDir) {
      await rm(cacheDir, { recursive: true, force: true })
      cacheDir = ''
    }
  })

  async function createCache(options?: ThumbnailCacheOptions) {
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ark-thumb-cache-'))
    return createThumbnailCache(cacheDir, options)
  }

  it('writes and reads meta plus slide pngs by version and manifest hash', async () => {
    const cache = await createCache()
    const key = buildThumbnailCacheKey('a0000000-0000-4000-8000-000000000001', 'abcdef0123456789')

    await cache.markPending(key, {
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: key.versionId,
      manifestHash: key.manifestHash,
      slideCount: 0,
      width: 480,
      height: 270,
    })

    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    await cache.writeSlidePng(key, 0, png)
    await cache.markReady(key, {
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: key.versionId,
      manifestHash: key.manifestHash,
      slideCount: 1,
      width: 480,
      height: 270,
    })

    const meta = await cache.readMeta(key)
    expect(meta?.status).toBe(THUMBNAIL_STATUS.ready)
    expect(meta?.slideCount).toBe(1)
    expect(await cache.readSlidePng(key, 0)).toEqual(png)
    expect(await readFile(path.join(cache.resolveDir(key), 'slide-0.png'))).toEqual(png)
  })

  it('treats a new version id as a cache miss', async () => {
    const cache = await createCache()
    const first = buildThumbnailCacheKey('a0000000-0000-4000-8000-000000000001', 'abcdef0123456789')
    const second = buildThumbnailCacheKey(
      'a0000000-0000-4000-8000-000000000002',
      'abcdef0123456789',
    )

    await cache.markReady(first, {
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId: first.versionId,
      manifestHash: first.manifestHash,
      slideCount: 1,
      width: 480,
      height: 270,
    })

    expect(await cache.readMeta(second)).toBeNull()
  })

  it('keeps manifests with a shared short prefix in separate cache entries', async () => {
    const cache = await createCache()
    const versionId = 'a0000000-0000-4000-8000-000000000001'
    const first = buildThumbnailCacheKey(
      versionId,
      'abcdef0100000000000000000000000000000000000000000000000000000000',
    )
    const second = buildThumbnailCacheKey(
      versionId,
      'abcdef01ffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    )

    await cache.markReady(first, {
      deckId: 'b0000000-0000-4000-8000-000000000001',
      versionId,
      manifestHash: first.manifestHash,
      slideCount: 1,
      width: 480,
      height: 270,
    })

    expect(cache.resolveDir(first)).not.toBe(cache.resolveDir(second))
    expect(await cache.readMeta(second)).toBeNull()
  })

  it('builds stable slide urls including a full manifest fingerprint', () => {
    const manifestHash = 'abcdef0123456789'
    expect(
      buildThumbnailSlideUrl(
        'b0000000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000001',
        2,
        manifestHash,
      ),
    ).toBe(
      `/api/decks/b0000000-0000-4000-8000-000000000001/thumbnails/a0000000-0000-4000-8000-000000000001/2.png?hash=${buildThumbnailManifestFingerprint(manifestHash)}`,
    )
  })

  it('evicts oldest cache entries when over the size bound', async () => {
    const cache = await createCache({ maxEntries: 2 })
    const keys: ReturnType<typeof buildThumbnailCacheKey>[] = []

    for (let index = 0; index < 3; index += 1) {
      const key = buildThumbnailCacheKey(
        `a0000000-0000-4000-8000-00000000000${index + 1}`,
        `hash${index}`,
      )
      keys.push(key)
      await cache.markReady(key, {
        deckId: 'b0000000-0000-4000-8000-000000000001',
        versionId: key.versionId,
        manifestHash: key.manifestHash,
        slideCount: 0,
        width: 480,
        height: 270,
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    await cache.cleanup()

    expect(await cache.readMeta(keys[0]!)).toBeNull()
    await expect(cache.readMeta(keys[1]!)).resolves.not.toBeNull()
    await expect(cache.readMeta(keys[2]!)).resolves.not.toBeNull()
  })
})
