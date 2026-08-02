import { createHash, randomBytes } from 'node:crypto'
import {
  copyFile,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import { resolveArkDataDir } from '../data-dir.ts'
import {
  THUMBNAIL_CACHE_MAX_ENTRIES,
  THUMBNAIL_STATUS,
  THUMBNAIL_TEMP_BLOB_GRACE_MS,
  type ThumbnailStatus,
} from './constants.ts'

const DEFAULT_CACHE_DIR = resolveArkDataDir('thumbnails')
const THUMBNAIL_BLOB_DIR_NAME = 'blobs'
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i

export type ThumbnailCacheMeta = {
  status: ThumbnailStatus
  deckId: string
  versionId: string
  manifestHash: string
  slideCount: number
  slideFingerprints?: string[]
  /** Bumps when the Electron capture pipeline changes; stale ready entries re-render. */
  rendererVersion?: string
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

function normalizeManifestHash(manifestHash: string) {
  return manifestHash.trim() || 'none'
}

function assertSafeFingerprint(fingerprint: string) {
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new Error('Invalid thumbnail blob fingerprint.')
  }
}

/**
 * A stable, filesystem- and URL-safe identity for the complete runtime
 * manifest hash. Do not truncate this value: a short prefix can make two
 * manifests address the same immutable thumbnail cache entry.
 */
export function buildThumbnailManifestFingerprint(manifestHash: string) {
  return createHash('sha256').update(normalizeManifestHash(manifestHash)).digest('hex')
}

export function buildThumbnailCacheKey(versionId: string, manifestHash: string): ThumbnailCacheKey {
  return {
    versionId,
    manifestHash: normalizeManifestHash(manifestHash),
  }
}

export function thumbnailCacheDirName(key: ThumbnailCacheKey) {
  return `${key.versionId}-${buildThumbnailManifestFingerprint(key.manifestHash)}`
}

export function buildThumbnailSlideUrl(
  deckId: string,
  versionId: string,
  slideIndex: number,
  manifestHash: string,
  slideFingerprint?: string,
) {
  const params = new URLSearchParams({
    hash: slideFingerprint ?? buildThumbnailManifestFingerprint(manifestHash),
  })
  return `/api/decks/${encodeURIComponent(deckId)}/thumbnails/${encodeURIComponent(versionId)}/${slideIndex}.png?${params.toString()}`
}

export type ThumbnailCacheOptions = {
  /** Internal test knob; production uses the configured default. */
  maxEntries?: number
}

export type ThumbnailCache = {
  rootDir: string
  resolveDir: (key: ThumbnailCacheKey) => string
  resolveBlobPath: (fingerprint: string) => string
  readMeta: (key: ThumbnailCacheKey) => Promise<ThumbnailCacheMeta | null>
  writeMeta: (key: ThumbnailCacheKey, meta: ThumbnailCacheMeta) => Promise<void>
  hasBlob: (fingerprint: string) => Promise<boolean>
  readBlobPng: (fingerprint: string) => Promise<Buffer | null>
  writeSlidePng: (
    key: ThumbnailCacheKey,
    slideIndex: number,
    png: Buffer,
    fingerprint?: string,
  ) => Promise<void>
  materializeSlidePngFromBlob: (
    key: ThumbnailCacheKey,
    slideIndex: number,
    fingerprint: string,
  ) => Promise<boolean>
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

export function createThumbnailCache(
  cacheDir = DEFAULT_CACHE_DIR,
  options: ThumbnailCacheOptions = {},
): ThumbnailCache {
  const maxEntries = options.maxEntries ?? THUMBNAIL_CACHE_MAX_ENTRIES
  const resolveDir = (key: ThumbnailCacheKey) => path.join(cacheDir, thumbnailCacheDirName(key))
  const resolveBlobPath = (fingerprint: string) => {
    assertSafeFingerprint(fingerprint)
    return path.join(cacheDir, THUMBNAIL_BLOB_DIR_NAME, `${fingerprint.toLowerCase()}.png`)
  }

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

  const hasBlob = async (fingerprint: string) => {
    try {
      const blobStat = await stat(resolveBlobPath(fingerprint))
      return blobStat.isFile()
    } catch {
      return false
    }
  }

  const readBlobPng = async (fingerprint: string) => {
    try {
      return await readFile(resolveBlobPath(fingerprint))
    } catch {
      return null
    }
  }

  const materializeSlidePngFromBlob: ThumbnailCache['materializeSlidePngFromBlob'] = async (
    key,
    slideIndex,
    fingerprint,
  ) => {
    const blobPath = resolveBlobPath(fingerprint)
    const dir = resolveDir(key)
    const slidePath = path.join(dir, slideFileName(slideIndex))

    try {
      await stat(blobPath)
    } catch {
      return false
    }

    await ensureDir(dir)
    await rm(slidePath, { force: true })

    try {
      await link(blobPath, slidePath)
    } catch {
      await copyFile(blobPath, slidePath)
    }

    return true
  }

  const writeBlobPng = async (fingerprint: string, png: Buffer) => {
    const blobDir = path.join(cacheDir, THUMBNAIL_BLOB_DIR_NAME)
    await ensureDir(blobDir)
    const blobPath = resolveBlobPath(fingerprint)

    if (await hasBlob(fingerprint)) {
      return
    }

    // Write the full payload to a temp file first, then publish exclusively so a
    // crash cannot leave a truncated content-addressed blob that `wx` would keep.
    const tempPath = path.join(
      blobDir,
      `.${fingerprint.toLowerCase()}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`,
    )
    await writeFile(tempPath, png)

    try {
      try {
        await link(tempPath, blobPath)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code

        if (code === 'EEXIST') {
          return
        }

        // Filesystems that reject hardlinks: fall back to exclusive create from
        // the already-complete temp file via rename when possible.
        if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EXDEV') {
          try {
            await rename(tempPath, blobPath)
            return
          } catch (renameError) {
            if ((renameError as NodeJS.ErrnoException).code === 'EEXIST') {
              return
            }

            try {
              await writeFile(blobPath, png, { flag: 'wx' })
            } catch (writeError) {
              if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw writeError
              }
            }
            return
          }
        }

        throw error
      }
    } finally {
      await rm(tempPath, { force: true })
    }
  }

  const writeSlidePng: ThumbnailCache['writeSlidePng'] = async (
    key,
    slideIndex,
    png,
    fingerprint,
  ) => {
    const dir = resolveDir(key)
    await ensureDir(dir)

    if (fingerprint) {
      await writeBlobPng(fingerprint, png)
      await materializeSlidePngFromBlob(key, slideIndex, fingerprint)
      return
    }

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
      attempts: input.attempts ?? existing?.attempts ?? 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await writeMeta(key, meta)
    return meta
  }

  const collectReferencedFingerprints = async (versionDirs: { name: string }[]) => {
    const referenced = new Set<string>()

    await Promise.all(
      versionDirs.map(async (entry) => {
        try {
          const raw = await readFile(path.join(cacheDir, entry.name, 'meta.json'), 'utf8')
          const meta = JSON.parse(raw) as ThumbnailCacheMeta

          for (const fingerprint of meta.slideFingerprints ?? []) {
            if (FINGERPRINT_PATTERN.test(fingerprint)) {
              referenced.add(fingerprint.toLowerCase())
            }
          }
        } catch {
          // Ignore unreadable/missing meta while sweeping orphans.
        }
      }),
    )

    return referenced
  }

  const cleanupOrphanBlobs = async (versionDirs: { name: string }[]) => {
    const blobDir = path.join(cacheDir, THUMBNAIL_BLOB_DIR_NAME)

    let blobEntries: string[]
    try {
      blobEntries = await readdir(blobDir)
    } catch {
      return
    }

    const referenced = await collectReferencedFingerprints(versionDirs)

    const nowMs = Date.now()

    await Promise.all(
      blobEntries.map(async (name) => {
        const blobPath = path.join(blobDir, name)

        if (name.endsWith('.tmp') || name.startsWith('.')) {
          // Skip recent temps so deferred cleanup cannot race an in-flight write.
          try {
            const tempStat = await stat(blobPath)
            if (nowMs - tempStat.mtimeMs < THUMBNAIL_TEMP_BLOB_GRACE_MS) {
              return
            }
          } catch {
            return
          }

          await rm(blobPath, { force: true })
          return
        }

        if (!name.endsWith('.png')) {
          return
        }

        const fingerprint = name.slice(0, -'.png'.length)

        if (!FINGERPRINT_PATTERN.test(fingerprint) || referenced.has(fingerprint.toLowerCase())) {
          return
        }

        await rm(blobPath, { force: true })
      }),
    )
  }

  const cleanup = async () => {
    await ensureDir(cacheDir)

    const entries = await readdir(cacheDir, { withFileTypes: true })
    const dirs = entries.filter(
      (entry) => entry.isDirectory() && entry.name !== THUMBNAIL_BLOB_DIR_NAME,
    )

    if (dirs.length > maxEntries) {
      const ranked = await Promise.all(
        dirs.map(async (entry) => {
          const dirPath = path.join(cacheDir, entry.name)
          const metaPath = path.join(dirPath, 'meta.json')

          try {
            const metaStat = await stat(metaPath)
            return { dirPath, name: entry.name, mtimeMs: metaStat.mtimeMs }
          } catch {
            try {
              const dirStat = await stat(dirPath)
              return { dirPath, name: entry.name, mtimeMs: dirStat.mtimeMs }
            } catch {
              return { dirPath, name: entry.name, mtimeMs: 0 }
            }
          }
        }),
      )

      ranked.sort((left, right) => left.mtimeMs - right.mtimeMs)
      const excess = ranked.length - maxEntries

      await Promise.all(
        ranked.slice(0, excess).map((entry) => rm(entry.dirPath, { recursive: true, force: true })),
      )
    }

    const remaining = await readdir(cacheDir, { withFileTypes: true })
    const remainingDirs = remaining.filter(
      (entry) => entry.isDirectory() && entry.name !== THUMBNAIL_BLOB_DIR_NAME,
    )
    await cleanupOrphanBlobs(remainingDirs)
  }

  return {
    rootDir: cacheDir,
    resolveDir,
    resolveBlobPath,
    readMeta,
    writeMeta,
    hasBlob,
    readBlobPng,
    writeSlidePng,
    materializeSlidePngFromBlob,
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
