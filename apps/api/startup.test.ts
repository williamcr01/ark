import { describe, expect, it, vi } from 'vitest'

import { createMemoryPostgresPool } from './db/test-utils.ts'
import { runStartupMigrations } from './startup.ts'

describe('runStartupMigrations', () => {
  it('skips migration when DATABASE_URL is unset', async () => {
    const result = await runStartupMigrations({})
    expect(result).toEqual({ skipped: true })
  })

  it('reuses and leaves an injected pool open', async () => {
    const pool = createMemoryPostgresPool()
    const end = vi.spyOn(pool, 'end')

    try {
      const result = await runStartupMigrations(
        { DATABASE_URL: 'postgres://unused-in-test/ark' },
        pool,
      )

      expect(result.skipped).toBe(false)
      expect(end).not.toHaveBeenCalled()
    } finally {
      await pool.end?.()
    }
  })
})
