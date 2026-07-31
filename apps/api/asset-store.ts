import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { createPostgresAssetStore } from './db/repositories/assets.ts'
import {
  type AssetRecord,
  type AssetStore,
  type CreateAssetInput,
  isValidAssetId,
} from './asset-record.ts'
import { isValidDeckId } from './deck-record.ts'
import { getAssetCategory } from '@ark/deck-core/assets.ts'
import { REPO_ROOT } from './repo-root.ts'

const DEFAULT_DATA_DIR = path.resolve(REPO_ROOT, 'data', 'assets', 'meta')

function resolveAssetPath(dataDir: string, id: string) {
  if (!isValidAssetId(id)) {
    return null
  }

  const resolvedDataDir = path.resolve(dataDir)
  const resolvedPath = path.resolve(resolvedDataDir, `${id}.json`)
  const prefix = resolvedDataDir.endsWith(path.sep)
    ? resolvedDataDir
    : `${resolvedDataDir}${path.sep}`

  if (!resolvedPath.startsWith(prefix)) {
    return null
  }

  return resolvedPath
}

async function ensureDataDir(dataDir: string) {
  await mkdir(dataDir, { recursive: true })
}

function parseAssetRecord(raw: string): AssetRecord | null {
  const parsed = JSON.parse(raw) as Partial<AssetRecord>

  if (
    typeof parsed.id !== 'string' ||
    typeof parsed.storageKey !== 'string' ||
    typeof parsed.createdAt !== 'string'
  ) {
    return null
  }

  return {
    id: parsed.id,
    deckId: typeof parsed.deckId === 'string' ? parsed.deckId : null,
    chatMessageId: typeof parsed.chatMessageId === 'string' ? parsed.chatMessageId : null,
    filename: typeof parsed.filename === 'string' ? parsed.filename : '',
    mediaType: typeof parsed.mediaType === 'string' ? parsed.mediaType : 'application/octet-stream',
    category: parsed.category ?? getAssetCategory(parsed.mediaType ?? ''),
    byteSize: typeof parsed.byteSize === 'number' ? parsed.byteSize : 0,
    checksum: typeof parsed.checksum === 'string' ? parsed.checksum : '',
    source: parsed.source ?? 'upload',
    storageKind: typeof parsed.storageKind === 'string' ? parsed.storageKind : 'local',
    storageKey: parsed.storageKey,
    createdAt: parsed.createdAt,
    deletedAt: typeof parsed.deletedAt === 'string' ? parsed.deletedAt : null,
  }
}

async function readAssetFile(filePath: string): Promise<AssetRecord | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return parseAssetRecord(raw)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function writeAssetFile(filePath: string, record: AssetRecord) {
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(tempPath, JSON.stringify(record, null, 2), 'utf8')
  await rename(tempPath, filePath)
}

async function readAllAssets(dataDir: string): Promise<AssetRecord[]> {
  try {
    const entries = await readdir(dataDir, { withFileTypes: true })
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => {
          const filePath = path.resolve(dataDir, entry.name)
          return readAssetFile(filePath)
        }),
    )

    return records.filter((record): record is AssetRecord => Boolean(record))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

export function createAssetStore(dataDir = DEFAULT_DATA_DIR): AssetStore {
  let claimQueue = Promise.resolve()

  const createAsset = async (input: CreateAssetInput): Promise<AssetRecord> => {
    await ensureDataDir(dataDir)

    const id = randomUUID()
    const filePath = resolveAssetPath(dataDir, id)

    if (!filePath) {
      throw new Error('Generated asset id is invalid.')
    }

    const record: AssetRecord = {
      id,
      deckId: input.deckId,
      chatMessageId: input.chatMessageId ?? null,
      filename: input.filename,
      mediaType: input.mediaType,
      category: input.category,
      byteSize: input.byteSize,
      checksum: input.checksum,
      source: input.source,
      storageKind: input.storageKind,
      storageKey: input.storageKey,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    }

    await writeAssetFile(filePath, record)

    return record
  }

  const getAsset = async (id: string) => {
    const filePath = resolveAssetPath(dataDir, id)

    if (!filePath) {
      return null
    }

    const record = await readAssetFile(filePath)

    if (!record || record.deletedAt) {
      return null
    }

    return record
  }

  const listAssetsByDeck = async (deckId: string) => {
    if (!isValidDeckId(deckId)) {
      return []
    }

    const records = await readAllAssets(dataDir)

    return records
      .filter((record) => record.deckId === deckId && !record.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  const softDelete = async (record: AssetRecord) => {
    const filePath = resolveAssetPath(dataDir, record.id)

    if (!filePath) {
      return
    }

    await writeAssetFile(filePath, { ...record, deletedAt: new Date().toISOString() })
  }

  const claimAssetsForDeck = async (rawIds: readonly string[], deckId: string) => {
    if (!isValidDeckId(deckId)) return null

    const previousClaim = claimQueue
    let releaseClaim!: () => void
    claimQueue = new Promise<void>((resolve) => {
      releaseClaim = resolve
    })
    await previousClaim

    try {
      const ids = [...new Set(rawIds)]
      const records = await Promise.all(ids.map((id) => getAsset(id)))
      if (records.some((record) => !record || record.deckId !== null)) return null

      const claimed = records as AssetRecord[]
      const written: AssetRecord[] = []
      try {
        for (const record of claimed) {
          const filePath = resolveAssetPath(dataDir, record.id)
          if (!filePath) throw new Error('Asset id is invalid.')
          await writeAssetFile(filePath, { ...record, deckId })
          written.push(record)
        }
      } catch (error) {
        await Promise.all(
          written.map(async (record) => {
            const filePath = resolveAssetPath(dataDir, record.id)
            if (filePath) await writeAssetFile(filePath, record)
          }),
        )
        throw error
      }
      return claimed.map((record) => ({ ...record, deckId }))
    } finally {
      releaseClaim()
    }
  }

  const deleteExpiredUnassignedAssets = async (cutoff: string) => {
    const records = (await readAllAssets(dataDir)).filter(
      (record) => record.deckId === null && !record.deletedAt && record.createdAt < cutoff,
    )
    await Promise.all(records.map((record) => softDelete(record)))
    return records
  }

  const deleteAsset = async (id: string) => {
    const record = await getAsset(id)

    if (!record) {
      return null
    }

    await softDelete(record)

    return record
  }

  const deleteAssetsByDeck = async (deckId: string) => {
    if (!isValidDeckId(deckId)) {
      return []
    }

    const records = (await readAllAssets(dataDir)).filter(
      (record) => record.deckId === deckId && !record.deletedAt,
    )

    await Promise.all(records.map((record) => softDelete(record)))

    return records
  }

  const deleteAssetsByChatMessage = async (chatMessageId: string) => {
    const records = (await readAllAssets(dataDir)).filter(
      (record) => record.chatMessageId === chatMessageId && !record.deletedAt,
    )

    await Promise.all(records.map((record) => softDelete(record)))

    return records
  }

  return {
    createAsset,
    getAsset,
    listAssetsByDeck,
    claimAssetsForDeck,
    deleteExpiredUnassignedAssets,
    deleteAsset,
    deleteAssetsByDeck,
    deleteAssetsByChatMessage,
  }
}

export function createDefaultAssetStore(env = process.env): AssetStore {
  if (env.DATABASE_URL?.trim()) {
    return createPostgresAssetStore()
  }

  return createAssetStore()
}

export const assetStore = createDefaultAssetStore()
