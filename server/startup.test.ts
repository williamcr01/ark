import { describe, expect, it } from 'vitest'

import { runStartupMigrations } from './startup.ts'

describe('runStartupMigrations', () => {
  it('skips migration when DATABASE_URL is unset', async () => {
    const result = await runStartupMigrations({})
    expect(result).toEqual({ skipped: true })
  })
})
