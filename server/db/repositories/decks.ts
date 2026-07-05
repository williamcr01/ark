import { randomUUID } from 'node:crypto'

import { createPostgresPool, type ConnectablePool, type Queryable } from '../client.ts'
import { runMigrations } from '../migrate.ts'
import { parseDeckRuntimeManifest } from '../../../shared/deck-runtime-manifest.ts'
import { buildDeckRuntimeManifestFromHtml } from '../../deck-manifest.ts'
import {
  type DeckStore,
  type DeckSummary,
  type DeckValidationStatus,
  type DeckVersionDetail,
  type DeckVersionOptions,
  type DeckVersionSummary,
  type StoredDeck,
  extractDeckTitle,
  isValidDeckId,
  normalizeDeckTitle,
  normalizeDeckValidationStatus,
  normalizeDeckVersionSource,
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

type DeckVersionRow = {
  id: string
  deck_id: string
  version_number: number | string
  html: string
  title: string
  source: string
  validation_status: string
  runtime_metadata: Record<string, unknown> | null
  created_at: Date | string
  active_version_id: string | null
}

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

function readVersionSummary(row: DeckVersionRow): DeckVersionSummary {
  const metadata = row.runtime_metadata ?? {}

  return {
    id: row.id,
    deckId: row.deck_id,
    versionNumber: toVersionNumber(row.version_number) ?? 0,
    title: row.title,
    source: normalizeDeckVersionSource(row.source),
    summary: typeof metadata.summary === 'string' ? metadata.summary : null,
    validationStatus: normalizeDeckValidationStatus(row.validation_status),
    runtimeManifest: parseDeckRuntimeManifest(metadata.manifest),
    createdAt: toIsoString(row.created_at),
    isActive: row.id === row.active_version_id,
  }
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

function resolveVersionManifest(html: string, options: DeckVersionOptions = {}) {
  return options.runtimeManifest ?? buildDeckRuntimeManifestFromHtml(html)
}

function buildVersionMetadata(options: DeckVersionOptions, html: string) {
  const metadata: Record<string, unknown> = {}
  const manifest = resolveVersionManifest(html, options)

  if (options.summary) {
    metadata.summary = options.summary
  }

  metadata.manifest = manifest

  return metadata
}

function buildValidationReport(options: DeckVersionOptions) {
  return options.validationReport ?? {}
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

  const insertVersion = async (
    client: Queryable,
    params: {
      deckId: string
      versionNumber: number
      html: string
      title: string
      createdAt: Date
      options?: DeckVersionOptions
    },
  ) => {
    const versionId = randomUUID()
    const source = normalizeDeckVersionSource(params.options?.source)
    const validationStatus: DeckValidationStatus = normalizeDeckValidationStatus(
      params.options?.validationStatus ?? 'valid',
    )
    const metadata = buildVersionMetadata(params.options ?? {}, params.html)
    const validationReport = buildValidationReport(params.options ?? {})

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
          model_provider,
          model_name,
          validation_status,
          runtime_metadata,
          validation_report,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        versionId,
        params.deckId,
        params.versionNumber,
        params.html,
        params.title,
        source,
        ownerUserId,
        params.options?.modelProvider ?? null,
        params.options?.modelName ?? null,
        validationStatus,
        JSON.stringify(metadata),
        JSON.stringify(validationReport),
        params.createdAt,
      ],
    )

    return versionId
  }

  const createDeck = async (html: string, versionOptions: DeckVersionOptions = {}) => {
    await ensureReady()

    const deckId = randomUUID()
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

      const versionId = await insertVersion(client, {
        deckId,
        versionNumber: 1,
        html,
        title,
        createdAt,
        options: versionOptions,
      })

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

  const updateDeck = async (id: string, html: string, versionOptions: DeckVersionOptions = {}) => {
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
      const versionId = await insertVersion(client, {
        deckId: id,
        versionNumber: nextVersionNumber,
        html,
        title,
        createdAt: updatedAt,
        options: versionOptions,
      })

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

  const listVersions = async (deckId: string) => {
    if (!isValidDeckId(deckId)) {
      return null
    }

    await ensureReady()

    const deckResult = await pool.query<{ active_version_id: string | null }>(
      `
        SELECT active_version_id
        FROM decks
        WHERE id = $1
          AND deleted_at IS NULL
      `,
      [deckId],
    )

    if (!deckResult.rows[0]) {
      return null
    }

    const activeVersionId = deckResult.rows[0].active_version_id
    const result = await pool.query<DeckVersionRow>(
      `
        SELECT
          v.id,
          v.deck_id,
          v.version_number,
          v.html,
          v.title,
          v.source,
          v.validation_status,
          v.runtime_metadata,
          v.created_at,
          $2::uuid AS active_version_id
        FROM deck_versions v
        WHERE v.deck_id = $1
        ORDER BY v.version_number DESC
      `,
      [deckId, activeVersionId],
    )

    return result.rows.map(readVersionSummary)
  }

  const getVersion = async (deckId: string, versionId: string) => {
    if (!isValidDeckId(deckId) || !isValidDeckId(versionId)) {
      return null
    }

    await ensureReady()

    const result = await pool.query<DeckVersionRow>(
      `
        SELECT
          v.id,
          v.deck_id,
          v.version_number,
          v.html,
          v.title,
          v.source,
          v.validation_status,
          v.runtime_metadata,
          v.created_at,
          d.active_version_id
        FROM deck_versions v
        JOIN decks d ON d.id = v.deck_id
        WHERE v.deck_id = $1
          AND v.id = $2
          AND d.deleted_at IS NULL
      `,
      [deckId, versionId],
    )

    const row = result.rows[0]

    if (!row) {
      return null
    }

    const summary = readVersionSummary(row)

    return {
      ...summary,
      html: row.html,
    } satisfies DeckVersionDetail
  }

  const rollbackToVersion = async (deckId: string, versionId: string) => {
    const targetVersion = await getVersion(deckId, versionId)

    if (!targetVersion) {
      return null
    }

    return updateDeck(deckId, targetVersion.html, {
      source: 'rollback',
      summary: `Restored from version ${targetVersion.versionNumber}`,
      validationStatus: targetVersion.validationStatus,
      runtimeManifest: targetVersion.runtimeManifest ?? undefined,
    })
  }

  return {
    createDeck,
    getDeck,
    listDecks,
    updateDeck,
    updateDeckMetadata,
    deleteDeck,
    listVersions,
    getVersion,
    rollbackToVersion,
  }
}
