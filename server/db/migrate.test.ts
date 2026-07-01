import { describe, expect, it } from 'vitest'

import { readMigrationFiles, runMigrations } from './migrate.ts'
import { createMemoryPostgresPool } from './test-utils.ts'

describe('Postgres migrations', () => {
  it('loads checked-in migrations in order', async () => {
    const migrations = await readMigrationFiles()

    expect(migrations.map((migration) => migration.id)).toEqual(['001_foundation'])
  })

  it('creates the foundational SaaS tables and default records', async () => {
    const pool = createMemoryPostgresPool()

    try {
      const firstRun = await runMigrations(pool)
      const secondRun = await runMigrations(pool)

      expect(firstRun.applied).toEqual(['001_foundation'])
      expect(secondRun.skipped).toEqual(['001_foundation'])

      const userResult = await pool.query('SELECT id FROM users')
      const workspaceResult = await pool.query('SELECT id FROM workspaces')
      const deckTableResult = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'decks',
            'deck_versions',
            'chat_threads',
            'chat_messages',
            'assets',
            'generation_jobs'
          )
      `)

      expect(userResult.rows).toHaveLength(1)
      expect(workspaceResult.rows).toHaveLength(1)
      expect(deckTableResult.rows.map((row) => row.table_name).sort()).toEqual([
        'assets',
        'chat_messages',
        'chat_threads',
        'deck_versions',
        'decks',
        'generation_jobs',
      ])
    } finally {
      await pool.end?.()
    }
  })
})
