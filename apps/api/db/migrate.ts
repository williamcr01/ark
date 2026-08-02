import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPostgresPool, type ConnectablePool, type Queryable } from './client.ts'

export type Migration = {
  id: string
  filename: string
  sql: string
}

export type MigrationResult = {
  applied: string[]
  skipped: string[]
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
const MIGRATION_LOCK_KEYS = [0x41524b, 1] as const

const migrationFileCache = new Map<string, Promise<Migration[]>>()

export async function readMigrationFiles(migrationsDir = MIGRATIONS_DIR): Promise<Migration[]> {
  const cacheKey = path.resolve(migrationsDir)
  const cached = migrationFileCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const pending = (async () => {
    const entries = await readdir(migrationsDir, { withFileTypes: true })
    const filenames = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))

    return Promise.all(
      filenames.map(async (filename) => ({
        id: filename.replace(/\.sql$/i, ''),
        filename,
        sql: await readFile(path.join(migrationsDir, filename), 'utf8'),
      })),
    )
  })()

  migrationFileCache.set(cacheKey, pending)
  try {
    return await pending
  } catch (error) {
    migrationFileCache.delete(cacheKey)
    throw error
  }
}

async function ensureMigrationTable(database: Queryable) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS ark_schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function readAppliedMigrations(database: Queryable) {
  const result = await database.query<{ id: string }>(
    'SELECT id FROM ark_schema_migrations ORDER BY id ASC',
  )

  return new Set(result.rows.map((row) => row.id))
}

export async function runMigrations(pool: ConnectablePool): Promise<MigrationResult> {
  const client = await pool.connect()
  let locked = false

  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [...MIGRATION_LOCK_KEYS])
    locked = true
    await ensureMigrationTable(client)

    const migrations = await readMigrationFiles()
    const appliedMigrations = await readAppliedMigrations(client)
    const result: MigrationResult = {
      applied: [],
      skipped: [],
    }

    for (const migration of migrations) {
      if (appliedMigrations.has(migration.id)) {
        result.skipped.push(migration.id)
        continue
      }

      try {
        await client.query('BEGIN')
        await client.query(migration.sql)
        await client.query('INSERT INTO ark_schema_migrations (id) VALUES ($1)', [migration.id])
        await client.query('COMMIT')
        result.applied.push(migration.id)
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      }
    }

    return result
  } finally {
    if (locked) {
      await client
        .query('SELECT pg_advisory_unlock($1, $2)', [...MIGRATION_LOCK_KEYS])
        .catch(() => undefined)
    }
    client.release()
  }
}

async function runCli() {
  const pool = createPostgresPool()

  try {
    const result = await runMigrations(pool)
    const applied = result.applied.length
    const skipped = result.skipped.length

    console.log(`Postgres migrations complete: ${applied} applied, ${skipped} skipped.`)
  } finally {
    await pool.end?.()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli()
}
