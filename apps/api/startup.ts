import { createPostgresPool, type ConnectablePool } from './db/client.ts'
import { runMigrations } from './db/migrate.ts'

export async function runStartupMigrations(env = process.env, existingPool?: ConnectablePool) {
  if (!env.DATABASE_URL?.trim()) {
    return { skipped: true as const }
  }

  const pool = existingPool ?? createPostgresPool({ env })
  try {
    const result = await runMigrations(pool)
    return { skipped: false as const, result }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown migration error'
    throw new Error(`Postgres migration failed on startup: ${message}`, { cause: error })
  } finally {
    if (!existingPool) {
      await pool.end?.()
    }
  }
}
