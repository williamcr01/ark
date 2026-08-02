import { randomUUID } from 'node:crypto'

import { type ConnectablePool } from '../client.ts'
import {
  type AssetCategory,
  type AssetRecord,
  type AssetSource,
  type AssetStore,
  type CreateAssetInput,
  isValidAssetId,
} from '../../asset-record.ts'
import { getAssetCategory } from '@ark/deck-core/assets.ts'
import { isValidDeckId } from '../../deck-record.ts'
import { DEFAULT_WORKSPACE_ID, SYSTEM_USER_ID } from './decks.ts'

type AssetRow = {
  id: string
  deck_id: string | null
  chat_message_id: string | null
  filename: string | null
  media_type: string | null
  byte_size: number | string | null
  checksum: string | null
  source: string | null
  storage_kind: string | null
  storage_key: string | null
  metadata: Record<string, unknown> | null
  created_at: Date | string
  deleted_at: Date | string | null
}

type PostgresAssetStoreOptions = {
  pool: ConnectablePool
  now?: () => Date
  defaultOwnerUserId?: string
  defaultWorkspaceId?: string
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toByteSize(value: number | string | null) {
  if (value === null) {
    return 0
  }

  return typeof value === 'number' ? value : Number(value)
}

function mapAsset(row: AssetRow): AssetRecord {
  const metadata = row.metadata ?? {}
  const mediaType = row.media_type ?? 'application/octet-stream'
  const category =
    typeof metadata.category === 'string'
      ? (metadata.category as AssetCategory)
      : getAssetCategory(mediaType)

  return {
    id: row.id,
    deckId: row.deck_id,
    chatMessageId: row.chat_message_id,
    filename: row.filename ?? '',
    mediaType,
    category,
    byteSize: toByteSize(row.byte_size),
    checksum: row.checksum ?? '',
    source: (row.source as AssetSource) ?? 'upload',
    storageKind: row.storage_kind ?? 'local',
    storageKey: row.storage_key ?? '',
    createdAt: toIsoString(row.created_at),
    deletedAt: row.deleted_at ? toIsoString(row.deleted_at) : null,
  }
}

const SELECT_COLUMNS = `
  id,
  deck_id,
  chat_message_id,
  filename,
  media_type,
  byte_size,
  checksum,
  source,
  storage_kind,
  storage_key,
  metadata,
  created_at,
  deleted_at
`

export function createPostgresAssetStore(options: PostgresAssetStoreOptions): AssetStore {
  const pool = options.pool
  const now = options.now ?? (() => new Date())
  const ownerUserId = options.defaultOwnerUserId ?? SYSTEM_USER_ID
  const workspaceId = options.defaultWorkspaceId ?? DEFAULT_WORKSPACE_ID

  const createAsset = async (input: CreateAssetInput): Promise<AssetRecord> => {
    const id = randomUUID()
    const createdAt = now()
    const metadata = { category: input.category }

    const result = await pool.query<AssetRow>(
      `
        INSERT INTO assets (
          id,
          deck_id,
          workspace_id,
          owner_user_id,
          chat_message_id,
          filename,
          media_type,
          byte_size,
          checksum,
          source,
          storage_kind,
          storage_key,
          metadata,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
        RETURNING ${SELECT_COLUMNS}
      `,
      [
        id,
        input.deckId,
        workspaceId,
        ownerUserId,
        input.chatMessageId ?? null,
        input.filename,
        input.mediaType,
        input.byteSize,
        input.checksum,
        input.source,
        input.storageKind,
        input.storageKey,
        JSON.stringify(metadata),
        createdAt,
      ],
    )

    return mapAsset(result.rows[0])
  }

  const getAsset = async (id: string) => {
    if (!isValidAssetId(id)) {
      return null
    }

    const result = await pool.query<AssetRow>(
      `
        SELECT ${SELECT_COLUMNS}
        FROM assets
        WHERE id = $1
          AND deleted_at IS NULL
      `,
      [id],
    )

    return result.rows[0] ? mapAsset(result.rows[0]) : null
  }

  const listAssetsByDeck = async (deckId: string) => {
    if (!isValidDeckId(deckId)) {
      return []
    }

    const result = await pool.query<AssetRow>(
      `
        SELECT ${SELECT_COLUMNS}
        FROM assets
        WHERE deck_id = $1
          AND deleted_at IS NULL
        ORDER BY created_at DESC
      `,
      [deckId],
    )

    return result.rows.map(mapAsset)
  }

  const claimAssetsForDeck = async (rawIds: readonly string[], deckId: string) => {
    const ids = [...new Set(rawIds)]
    if (!isValidDeckId(deckId) || ids.some((id) => !isValidAssetId(id))) return null
    if (ids.length === 0) return []

    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      const candidates = await client.query<{ id: string }>(
        `
          SELECT id
          FROM assets
          WHERE id IN (${ids.map((_, index) => `$${index + 1}`).join(', ')})
            AND deck_id IS NULL
            AND deleted_at IS NULL
          FOR UPDATE
        `,
        ids,
      )
      if (candidates.rows.length !== ids.length) {
        await client.query('ROLLBACK')
        return null
      }
      const result = await client.query<AssetRow>(
        `
          UPDATE assets
          SET deck_id = $1
          WHERE id IN (${ids.map((_, index) => `$${index + 2}`).join(', ')})
            AND deck_id IS NULL
            AND deleted_at IS NULL
          RETURNING ${SELECT_COLUMNS}
        `,
        [deckId, ...ids],
      )
      if (result.rows.length !== ids.length) {
        await client.query('ROLLBACK')
        return null
      }
      await client.query('COMMIT')
      return result.rows.map(mapAsset)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  const deleteExpiredUnassignedAssets = async (cutoff: string) => {
    const result = await pool.query<AssetRow>(
      `
        UPDATE assets
        SET deleted_at = $2
        WHERE deck_id IS NULL
          AND deleted_at IS NULL
          AND created_at < $1
        RETURNING ${SELECT_COLUMNS}
      `,
      [cutoff, now()],
    )
    return result.rows.map(mapAsset)
  }

  const deleteAsset = async (id: string) => {
    if (!isValidAssetId(id)) {
      return null
    }

    const result = await pool.query<AssetRow>(
      `
        UPDATE assets
        SET deleted_at = $2
        WHERE id = $1
          AND deleted_at IS NULL
        RETURNING ${SELECT_COLUMNS}
      `,
      [id, now()],
    )

    return result.rows[0] ? mapAsset(result.rows[0]) : null
  }

  const deleteAssetsByDeck = async (deckId: string) => {
    if (!isValidDeckId(deckId)) {
      return []
    }

    const result = await pool.query<AssetRow>(
      `
        UPDATE assets
        SET deleted_at = $2
        WHERE deck_id = $1
          AND deleted_at IS NULL
        RETURNING ${SELECT_COLUMNS}
      `,
      [deckId, now()],
    )

    return result.rows.map(mapAsset)
  }

  const deleteAssetsByChatMessage = async (chatMessageId: string) => {
    const result = await pool.query<AssetRow>(
      `
        UPDATE assets
        SET deleted_at = $2
        WHERE chat_message_id = $1
          AND deleted_at IS NULL
        RETURNING ${SELECT_COLUMNS}
      `,
      [chatMessageId, now()],
    )

    return result.rows.map(mapAsset)
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
