import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'
import { DataType, newDb } from 'pg-mem'

import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import type { DeckValidationReport } from '@ark/deck-core/deck-validate.ts'

import type { ConnectablePool } from './client.ts'
import { runMigrations } from './migrate.ts'

export function createMemoryPostgresPool() {
  const db = newDb({ noAstCoverageCheck: true })
  for (const name of ['pg_advisory_lock', 'pg_advisory_unlock']) {
    db.public.registerFunction({
      name,
      args: [DataType.integer, DataType.integer],
      returns: DataType.bool,
      implementation: () => true,
    })
  }
  const { Pool } = db.adapters.createPg()

  return new Pool() as ConnectablePool
}

export async function createTestPostgresPool(): Promise<ConnectablePool> {
  const connectionString = process.env.TEST_DATABASE_URL?.trim()
  if (!connectionString) {
    return createMemoryPostgresPool()
  }

  const schema = `ark_test_${randomUUID().replaceAll('-', '')}`
  const adminPool = new Pool({ connectionString })
  await adminPool.query(`CREATE SCHEMA ${schema}`)

  const pool = new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
  })
  const endPool = pool.end.bind(pool)
  Object.defineProperty(pool, 'end', {
    value: async () => {
      await endPool()
      try {
        await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      } finally {
        await adminPool.end()
      }
    },
  })

  return pool as ConnectablePool
}

/** Fresh test pool with migrations already applied. Uses real Postgres when configured. */
export async function createMigratedTestPostgresPool() {
  const pool = await createTestPostgresPool()
  try {
    await runMigrations(pool)
    return pool
  } catch (error) {
    await pool.end?.()
    throw error
  }
}

/** Clear app data between tests while keeping users/workspaces/migration rows. */
export async function truncatePostgresAppTables(pool: ConnectablePool) {
  // pg-mem rejects multi-table TRUNCATE; delete in FK-safe order instead.
  for (const table of [
    'generation_jobs',
    'assets',
    'chat_messages',
    'chat_threads',
    'deck_versions',
    'decks',
  ]) {
    await pool.query(`DELETE FROM ${table}`)
  }
}

/** Skip JSDOM parse/validate on create/update paths that don't assert manifest shape. */
export const stubStaticRuntimeManifest = {
  schemaVersion: 1,
  runtimeMode: 'static',
  previewMode: 'css-only',
  structure: 'plain',
  slideSelector: 'section.slide',
  slideCount: 1,
  aspectRatio: '16:9',
  scripts: { inline: 0, external: 0, allowed: false },
  assets: [],
  network: { externalUrls: [], connectAllowed: false },
  validation: { valid: true, warnings: 0, errors: 0 },
  usesRevealAdapter: false,
  warnings: [],
} satisfies DeckRuntimeManifest

export const stubValidDeckValidation = {
  valid: true,
  slideCount: 1,
  scripts: [],
  forms: 0,
  iframes: 0,
  externalUrls: [],
  malformedSlides: [],
  runtimeMarkers: {
    runtimeMode: 'static',
    arkDeck: null,
    arkPreview: null,
    arkRuntime: null,
    arkRuntimeLib: null,
    arkRuntimeVersion: null,
    approvedRuntimeId: null,
    approvedRuntimeVersion: null,
  },
  issues: [],
} satisfies DeckValidationReport
