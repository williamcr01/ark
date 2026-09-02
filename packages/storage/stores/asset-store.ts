import { createHash, randomUUID } from 'node:crypto'

import type { AssetRecord, AssetStore, CreateAssetInput } from '../records/asset-record.ts'
import { createWorkspaceStore, type WorkspaceStore } from './workspace-store.ts'

function toRecord(deckId: string, row: Record<string, unknown>): AssetRecord {
  return {
    id: String(row.id),
    deckId,
    chatMessageId: null,
    filename: String(row.filename),
    mediaType: String(row.media_type),
    category: row.category as AssetRecord['category'],
    byteSize: Number(row.byte_size),
    checksum: String(row.blob_checksum),
    source: row.source as AssetRecord['source'],
    createdAt: String(row.created_at),
  }
}

async function insertDeckAsset(workspaces: WorkspaceStore, input: CreateAssetInput) {
  const database = await workspaces.database(input.deckId)
  if (!database) throw new Error('Deck not found.')
  const checksum = createHash('sha256').update(input.bytes).digest('hex')
  const id = randomUUID()
  const now = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT OR IGNORE INTO blobs
           (checksum, media_type, byte_size, bytes, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(checksum, input.mediaType, input.bytes.byteLength, input.bytes, now)
    database
      .prepare(
        `INSERT INTO assets
           (id, blob_checksum, filename, media_type, category, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, checksum, input.filename, input.mediaType, input.category, input.source, now)
    if (input.chatMessageId) {
      database
        .prepare(
          `INSERT OR IGNORE INTO asset_references
             (asset_id, owner_type, owner_id, purpose) VALUES (?, 'message', ?, 'attachment')`,
        )
        .run(id, input.chatMessageId)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return {
    id,
    deckId: input.deckId,
    chatMessageId: input.chatMessageId ?? null,
    filename: input.filename,
    mediaType: input.mediaType,
    category: input.category,
    byteSize: input.bytes.byteLength,
    checksum,
    source: input.source,
    createdAt: now,
  }
}

export function createAssetStore(
  workspaceOrDirectory: WorkspaceStore | string = createWorkspaceStore(),
): AssetStore {
  const workspaces =
    typeof workspaceOrDirectory === 'string'
      ? createWorkspaceStore(workspaceOrDirectory)
      : workspaceOrDirectory

  const createAsset = async (input: CreateAssetInput) => insertDeckAsset(workspaces, input)

  const getAsset = async (deckId: string, id: string) => {
    const database = await workspaces.database(deckId)
    if (!database) return null
    const row = database
      .prepare(
        `SELECT a.*, b.byte_size FROM assets a
         JOIN blobs b ON b.checksum = a.blob_checksum WHERE a.id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined
    return row ? toRecord(deckId, row) : null
  }

  const readBytes = async (deckId: string, id: string) => {
    const database = await workspaces.database(deckId)
    if (!database) return null
    const row = database
      .prepare(
        `SELECT b.bytes FROM assets a JOIN blobs b ON b.checksum = a.blob_checksum WHERE a.id = ?`,
      )
      .get(id) as { bytes: Uint8Array } | undefined
    return row ? Buffer.from(row.bytes) : null
  }

  const listAssetsByDeck = async (deckId: string) => {
    const database = await workspaces.database(deckId)
    if (!database) return []
    return (
      database
        .prepare(
          `SELECT a.*, b.byte_size FROM assets a JOIN blobs b ON b.checksum = a.blob_checksum
           ORDER BY a.created_at DESC`,
        )
        .all() as Array<Record<string, unknown>>
    ).map((row) => toRecord(deckId, row))
  }

  const addReference: AssetStore['addReference'] = async (
    deckId,
    assetId,
    ownerType,
    ownerId,
    purpose,
  ) => {
    const database = await workspaces.database(deckId)
    if (!database) return false
    const exists = database.prepare('SELECT 1 FROM assets WHERE id = ?').get(assetId)
    if (!exists) return false
    database
      .prepare(
        `INSERT OR IGNORE INTO asset_references
         (asset_id, owner_type, owner_id, purpose) VALUES (?, ?, ?, ?)`,
      )
      .run(assetId, ownerType, ownerId, purpose)
    return true
  }

  const deleteAsset = async (deckId: string, id: string) => {
    const database = await workspaces.database(deckId)
    if (!database) return null
    const record = await getAsset(deckId, id)
    if (!record) return null
    const referenced = database
      .prepare('SELECT 1 FROM asset_references WHERE asset_id = ? LIMIT 1')
      .get(id)
    if (referenced) return null
    database.prepare('DELETE FROM assets WHERE id = ?').run(id)
    database
      .prepare(
        `DELETE FROM blobs WHERE checksum = ?
         AND NOT EXISTS (SELECT 1 FROM assets WHERE blob_checksum = ?)`,
      )
      .run(record.checksum, record.checksum)
    return record
  }

  return { createAsset, getAsset, readBytes, listAssetsByDeck, addReference, deleteAsset }
}
