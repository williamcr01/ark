import { newDb } from 'pg-mem'

import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import type { DeckValidationReport } from '@ark/deck-core/deck-validate.ts'

import type { ConnectablePool } from './client.ts'
import { runMigrations } from './migrate.ts'

export function createMemoryPostgresPool() {
  const db = newDb({ noAstCoverageCheck: true })
  const { Pool } = db.adapters.createPg()

  return new Pool() as ConnectablePool
}

/** Fresh pg-mem pool with migrations already applied (stores can use migrate: false). */
export async function createMigratedMemoryPostgresPool() {
  const pool = createMemoryPostgresPool()
  await runMigrations(pool)
  return pool
}

/** Clear app data between tests while keeping users/workspaces/migration rows. */
export async function truncateMemoryPostgresAppTables(pool: ConnectablePool) {
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
