import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createAssetStorageKey, createLocalAssetStorage } from './asset-storage.ts'

describe('local asset storage', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ark-asset-storage-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes, reads, and deletes bytes by opaque key', async () => {
    const storage = createLocalAssetStorage(dir)
    const key = createAssetStorageKey()
    const bytes = Buffer.from('hello asset')

    await storage.write(key, bytes)
    const read = await storage.read(key)
    expect(read?.equals(bytes)).toBe(true)

    expect(await storage.delete(key)).toBe(true)
    expect(await storage.read(key)).toBeNull()
    expect(await storage.delete(key)).toBe(false)
  })

  it('returns null for unknown keys', async () => {
    const storage = createLocalAssetStorage(dir)
    expect(await storage.read(createAssetStorageKey())).toBeNull()
  })

  it('rejects path-traversal storage keys', async () => {
    const storage = createLocalAssetStorage(dir)
    await expect(storage.write('../escape', Buffer.from('x'))).rejects.toThrow()
    expect(await storage.read('../escape')).toBeNull()
    expect(await storage.delete('../escape')).toBe(false)
  })

  it('reports its storage kind', () => {
    expect(createLocalAssetStorage(dir).kind).toBe('local')
  })
})
