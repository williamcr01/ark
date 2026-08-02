import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Binary blob storage for uploaded assets. The default implementation writes to
 * the local filesystem, but the interface is deliberately storage-agnostic so a
 * future adapter (S3, GCS, etc.) can be dropped in without touching callers.
 *
 * `storageKey` is an opaque, adapter-owned identifier. Callers must never treat
 * it as a filesystem path.
 */
export type AssetStorage = {
  readonly kind: string
  write: (key: string, bytes: Buffer) => Promise<void>
  read: (key: string) => Promise<Buffer | null>
  delete: (key: string) => Promise<boolean>
}

import { resolveArkDataDir } from './data-dir.ts'

const DEFAULT_STORAGE_DIR = resolveArkDataDir('assets', 'blobs')

/** Opaque storage keys are UUID basenames — never derived from user input. */
export function createAssetStorageKey() {
  return randomUUID()
}

const STORAGE_KEY_PATTERN = /^[0-9a-f-]{36}$/i

function resolveBlobPath(baseDir: string, key: string) {
  if (!STORAGE_KEY_PATTERN.test(key)) {
    return null
  }

  const resolvedBase = path.resolve(baseDir)
  const resolvedPath = path.resolve(resolvedBase, `${key}.bin`)
  const prefix = resolvedBase.endsWith(path.sep) ? resolvedBase : `${resolvedBase}${path.sep}`

  if (!resolvedPath.startsWith(prefix)) {
    return null
  }

  return resolvedPath
}

export function createLocalAssetStorage(baseDir = DEFAULT_STORAGE_DIR): AssetStorage {
  const ensureDir = async () => {
    await mkdir(baseDir, { recursive: true })
  }

  return {
    kind: 'local',
    write: async (key, bytes) => {
      const filePath = resolveBlobPath(baseDir, key)
      if (!filePath) {
        throw new Error('Invalid asset storage key.')
      }

      await ensureDir()
      const tempPath = `${filePath}.${randomUUID()}.tmp`
      await writeFile(tempPath, bytes)
      await rename(tempPath, filePath)
    },
    read: async (key) => {
      const filePath = resolveBlobPath(baseDir, key)
      if (!filePath) {
        return null
      }

      try {
        return await readFile(filePath)
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return null
        }

        throw error
      }
    },
    delete: async (key) => {
      const filePath = resolveBlobPath(baseDir, key)
      if (!filePath) {
        return false
      }

      try {
        await unlink(filePath)
        return true
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return false
        }

        throw error
      }
    },
  }
}

export function createDefaultAssetStorage(): AssetStorage {
  return createLocalAssetStorage()
}
