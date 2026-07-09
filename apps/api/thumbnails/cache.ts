import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { REPO_ROOT } from '../repo-root.ts'
import { THUMBNAIL_CACHE_MAX_ENTRIES, THUMBNAIL_STATUS, type ThumbnailStatus } from './constants.ts'

const DEFAULT_CACHE_DIR = path.resolve(REPO_ROOT, 'data', 'thumbnails')

export type ThumbnailCacheMeta = {
  status: ThumbnailStatus
  deckId: string
  versionId: string
  manifestHash: string
  slideCount: number
  width: number
  height: number
  /** Number of render attempts performed for this key (bounds failure retries). */
  attempts?: number
  error?: string
  createdAt: string
  updatedAt: string
}

export type ThumbnailCacheKey = {
  versionId: string
  manifestHash: string
}

export function buildThumbnailCacheKey(versionId: string, manifestHash: string): ThumbnailCacheKey {
  return {
    versionId,
    manifestHash: manifestHash || 'none',
  }
}

export function thumbnailCacheDirName(key: ThumbnailCacheKey) {
  const hash8 = key.manifestHash.slice(0, 8) || 'none'
  return `${key.versionId}-${hash8}`
}

export function buildThumbnailSlideUrl(
  deckId: string,
  versionId: string,
  slideIndex: number,
  manifestHash: string,
) {
  const params = new URLSearchParams({ hash: manifestHash.slice(0, 8) || 'none' })
  return `/api/decks/${encodeURIComponent(deckId)}/thumbnails/${encodeURIComponent(versionId)}/${slideIndex}.png?${params.toString()}`
}

export type ThumbnailCache = {
  rootDir: string
  resolveDir: (key: ThumbnailCacheKey) => string
  readMeta: (key: ThumbnailCacheKey) => Promise<ThumbnailCacheMeta | null>
  writeMeta: (key: ThumbnailCacheKey, meta: ThumbnailCacheMeta) => Promise<void>
  writeSlidePng: (key: ThumbnailCacheKey, slideIndex: number, png: Buffer) => Promise<void>
  readSlidePng: (key: ThumbnailCacheKey, slideIndex: number) => Promise<Buffer | null>
  markPending: (
    key: ThumbnailCacheKey,
    input: Omit<ThumbnailCacheMeta, 'status' | 'createdAt' | 'updatedAt' | 'error'>,
  ) => Promise<ThumbnailCacheMeta>
  markReady: (
    key: ThumbnailCacheKey,
    input: Omit<ThumbnailCacheMeta, 'status' | 'createdAt' | 'updatedAt' | 'error'>,
  ) => Promise<ThumbnailCacheMeta>
  markFailed: (
    key: ThumbnailCacheKey,
    input: Omit<ThumbnailCacheMeta, 'status' | 'createdAt' | 'updatedAt'> & { error: string },
  ) => Promise<ThumbnailCacheMeta>
  cleanup: () => Promise<void>
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true })
}

function slideFileName(slideIndex: number) {
  return `slide-${slideIndex}.png`
}

export function createThumbnailCache(cacheDir = DEFAULT_CACHE_DIR): ThumbnailCache {
  const resolveDir = (key: ThumbnailCacheKey) => path.join(cacheDir, thumbnailCacheDirName(key))

  const readMeta = async (key: ThumbnailCacheKey) => {
    try {
      const raw = await readFile(path.join(resolveDir(key), 'meta.json'), 'utf8')
      return JSON.parse(raw) as ThumbnailCacheMeta
    } catch {
      return null
    }
  }

  const writeMeta = async (key: ThumbnailCacheKey, meta: ThumbnailCacheMeta) => {
    const dir = resolveDir(key)
    await ensureDir(dir)
    await writeFile(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  }

  const writeSlidePng = async (key: ThumbnailCacheKey, slideIndex: number, png: Buffer) => {
    const dir = resolveDir(key)
    await ensureDir(dir)
    await writeFile(path.join(dir, slideFileName(slideIndex)), png)
  }

  const readSlidePng = async (key: ThumbnailCacheKey, slideIndex: number) => {
    try {
      return await readFile(path.join(resolveDir(key), slideFileName(slideIndex)))
    } catch {
      return null
    }
  }

  const markPending: ThumbnailCache['markPending'] = async (key, input) => {
    const existing = await readMeta(key)
    const now = new Date().toISOString()
    const meta: ThumbnailCacheMeta = {
      ...input,
      status: THUMBNAIL_STATUS.pending,
      attempts: (existing?.attempts ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await writeMeta(key, meta)
    return meta
  }

  const markReady: ThumbnailCache['markReady'] = async (key, input) => {
    const existing = await readMeta(key)
    const now = new Date().toISOString()
    const meta: ThumbnailCacheMeta = {
      ...input,
      status: THUMBNAIL_STATUS.ready,
      attempts: existing?.attempts ?? 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await writeMeta(key, meta)
    return meta
  }

  const markFailed: ThumbnailCache['markFailed'] = async (key, input) => {
    const existing = await readMeta(key)
    const now = new Date().toISOString()
    const meta: ThumbnailCacheMeta = {
      ...input,
      status: THUMBNAIL_STATUS.failed,
      attempts: existing?.attempts ?? 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await writeMeta(key, meta)
    return meta
  }

  const cleanup = async () => {
    await ensureDir(cacheDir)

    const entries = await readdir(cacheDir, { withFileTypes: true })
    const dirs = entries.filter((entry) => entry.isDirectory())

    if (dirs.length <= THUMBNAIL_CACHE_MAX_ENTRIES) {
      return
    }

    const ranked = await Promise.all(
      dirs.map(async (entry) => {
        const dirPath = path.join(cacheDir, entry.name)
        const metaPath = path.join(dirPath, 'meta.json')

        try {
          const metaStat = await stat(metaPath)
          return { dirPath, mtimeMs: metaStat.mtimeMs }
        } catch {
          try {
            const dirStat = await stat(dirPath)
            return { dirPath, mtimeMs: dirStat.mtimeMs }
          } catch {
            return { dirPath, mtimeMs: 0 }
          }
        }
      }),
    )

    ranked.sort((left, right) => left.mtimeMs - right.mtimeMs)
    const excess = ranked.length - THUMBNAIL_CACHE_MAX_ENTRIES

    await Promise.all(
      ranked.slice(0, excess).map((entry) => rm(entry.dirPath, { recursive: true, force: true })),
    )
  }

  return {
    rootDir: cacheDir,
    resolveDir,
    readMeta,
    writeMeta,
    writeSlidePng,
    readSlidePng,
    markPending,
    markReady,
    markFailed,
    cleanup,
  }
}

export function createDefaultThumbnailCache(env = process.env) {
  const configured = env.ARK_THUMBNAIL_CACHE_DIR?.trim()
  return createThumbnailCache(configured || DEFAULT_CACHE_DIR)
}
