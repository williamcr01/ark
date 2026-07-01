import { randomUUID } from 'node:crypto'

import { createPostgresPool, type ConnectablePool, type Queryable } from '../client.ts'
import { runMigrations } from '../migrate.ts'
import {
  type DeckStore,
  type DeckSummary,
  type StoredDeck,
  extractDeckTitle,
  isValidDeckId,
  normalizeDeckTitle,
} from '../../deck-record.ts'

export const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001'
export const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002'

type DeckRow = {
  id: string
  title: string
  html: string
  created_at: Date | string
  updated_at: Date | string
  active_version_id: string | null
  version_number: number | string | null
}

type DeckSummaryRow = Omit<DeckRow, 'html'>

type PostgresDeckStoreOptions = {
  pool?: ConnectablePool
  migrate?: boolean
  now?: () => Date
  defaultOwnerUserId?: string
  defaultWorkspaceId?: string
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toVersionNumber(value: number | string | null) {
  if (value === null) {
    return null
  }

  return typeof value === 'number' ? value : Number(value)
}

function mapDeck(row: DeckRow): StoredDeck {
  return {
    id: row.id,
    html: row.html,
    title: row.title,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    activeVersionId: row.active_version_id,
    versionNumber: toVersionNumber(row.version_number),
  }
}

function mapDeckSummary(row: DeckSummaryRow): DeckSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    activeVersionId: row.active_version_id,
    versionNumber: toVersionNumber(row.version_number),
  }
}

async function withTransaction<T>(
  pool: ConnectablePool,
  callback: (client: Queryable) => Promise<T>,
) {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')

    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function readDeckById(queryable: Queryable, id: string) {
  const result = await queryable.query<DeckRow>(
    `
      SELECT
        d.id,
        d.title,
        v.html,
        d.created_at,
        d.updated_at,
        d.active_version_id,
        v.version_number
      FROM decks d
      JOIN deck_versions v ON v.id = d.active_version_id
      WHERE d.id = $1
        AND d.deleted_at IS NULL
    `,
    [id],
  )

  return result.rows[0] ? mapDeck(result.rows[0]) : null
}

export function createPostgresDeckStore(options: PostgresDeckStoreOptions = {}): DeckStore {
  const pool = options.pool ?? createPostgresPool()
  const shouldMigrate = options.migrate ?? true
  const now = options.now ?? (() => new Date())
  const ownerUserId = options.defaultOwnerUserId ?? SYSTEM_USER_ID
  const workspaceId = options.defaultWorkspaceId ?? DEFAULT_WORKSPACE_ID
  let readyPromise: Promise<void> | null = null

  const ensureReady = async () => {
    if (!shouldMigrate) {
      return
    }

    readyPromise ??= runMigrations(pool).then(() => undefined)
    await readyPromise
  }

  const createDeck = async (html: string) => {
    await ensureReady()

    const deckId = randomUUID()
    const versionId = randomUUID()
    const createdAt = now()
    const title = extractDeckTitle(html)

    return withTransaction(pool, async (client) => {
      await client.query(
        `
          INSERT INTO decks (
            id,
            workspace_id,
            owner_user_id,
            title,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $5)
        `,
        [deckId, workspaceId, ownerUserId, title, createdAt],
      )

      await client.query(
        `
          INSERT INTO deck_versions (
            id,
            deck_id,
            version_number,
            html,
            title,
            source,
            author_user_id,
            created_at
          )
          VALUES ($1, $2, 1, $3, $4, 'manual', $5, $6)
        `,
        [versionId, deckId, html, title, ownerUserId, createdAt],
      )

      await client.query(
        `
          UPDATE decks
          SET active_version_id = $1
          WHERE id = $2
        `,
        [versionId, deckId],
      )

      const deck = await readDeckById(client, deckId)

      if (!deck) {
        throw new Error('Created deck could not be loaded from Postgres.')
      }

      return deck
    })
  }

  const getDeck = async (id: string) => {
    if (!isValidDeckId(id)) {
      return null
    }

    await ensureReady()

    return readDeckById(pool, id)
  }

  const listDecks = async () => {
    await ensureReady()

    const result = await pool.query<DeckSummaryRow>(
      `
        SELECT
          d.id,
          d.title,
          d.created_at,
          d.updated_at,
          d.active_version_id,
          v.version_number
        FROM decks d
        LEFT JOIN deck_versions v ON v.id = d.active_version_id
        WHERE d.deleted_at IS NULL
        ORDER BY d.updated_at DESC, d.created_at DESC
      `,
    )

    return result.rows.map(mapDeckSummary)
  }

  const updateDeck = async (id: string, html: string) => {
    if (!isValidDeckId(id)) {
      return null
    }

    await ensureReady()

    const updatedAt = now()

    return withTransaction(pool, async (client) => {
      const existing = await readDeckById(client, id)

      if (!existing) {
        return null
      }

      const title =
        existing.title === extractDeckTitle(existing.html) ? extractDeckTitle(html) : existing.title
      const versionResult = await client.query<{ version_number: number | string }>(
        `
          SELECT COALESCE(MAX(version_number), 0) AS version_number
          FROM deck_versions
          WHERE deck_id = $1
        `,
        [id],
      )
      const nextVersionNumber = Number(versionResult.rows[0]?.version_number ?? 0) + 1
      const versionId = randomUUID()

      await client.query(
        `
          INSERT INTO deck_versions (
            id,
            deck_id,
            version_number,
            html,
            title,
            source,
            author_user_id,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7)
        `,
        [versionId, id, nextVersionNumber, html, title, ownerUserId, updatedAt],
      )

      await client.query(
        `
          UPDATE decks
          SET
            title = $1,
            active_version_id = $2,
            updated_at = $3
          WHERE id = $4
        `,
        [title, versionId, updatedAt, id],
      )

      return readDeckById(client, id)
    })
  }

  const updateDeckMetadata = async (id: string, metadata: { title?: string }) => {
    if (!isValidDeckId(id)) {
      return null
    }

    await ensureReady()

    const updatedAt = now()
    const title = normalizeDeckTitle(metadata.title)
    const result = await pool.query<DeckRow>(
      `
        UPDATE decks
        SET
          title = $1,
          updated_at = $2
        WHERE id = $3
          AND deleted_at IS NULL
        RETURNING
          id,
          title,
          created_at,
          updated_at,
          active_version_id,
          (
            SELECT html
            FROM deck_versions
            WHERE id = decks.active_version_id
          ) AS html,
          (
            SELECT version_number
            FROM deck_versions
            WHERE id = decks.active_version_id
          ) AS version_number
      `,
      [title, updatedAt, id],
    )

    return result.rows[0] ? mapDeck(result.rows[0]) : null
  }

  const deleteDeck = async (id: string) => {
    if (!isValidDeckId(id)) {
      return false
    }

    await ensureReady()

    const deletedAt = now()
    const result = await pool.query<{ id: string }>(
      `
        UPDATE decks
        SET deleted_at = $1,
            updated_at = $1
        WHERE id = $2
          AND deleted_at IS NULL
        RETURNING id
      `,
      [deletedAt, id],
    )

    return Boolean(result.rows[0])
  }

  return {
    createDeck,
    getDeck,
    listDecks,
    updateDeck,
    updateDeckMetadata,
    deleteDeck,
  }
}
