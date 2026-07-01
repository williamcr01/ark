import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPostgresPool, type ConnectablePool } from './client.ts'

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

export async function readMigrationFiles(migrationsDir = MIGRATIONS_DIR): Promise<Migration[]> {
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
}

async function ensureMigrationTable(pool: ConnectablePool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ark_schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function readAppliedMigrations(pool: ConnectablePool) {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM ark_schema_migrations ORDER BY id ASC',
  )

  return new Set(result.rows.map((row) => row.id))
}

export async function runMigrations(pool: ConnectablePool): Promise<MigrationResult> {
  await ensureMigrationTable(pool)

  const migrations = await readMigrationFiles()
  const appliedMigrations = await readAppliedMigrations(pool)
  const result: MigrationResult = {
    applied: [],
    skipped: [],
  }

  for (const migration of migrations) {
    if (appliedMigrations.has(migration.id)) {
      result.skipped.push(migration.id)
      continue
    }

    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await client.query(migration.sql)
      await client.query('INSERT INTO ark_schema_migrations (id) VALUES ($1)', [migration.id])
      await client.query('COMMIT')
      result.applied.push(migration.id)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  return result
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
