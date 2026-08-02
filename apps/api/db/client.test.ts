import { describe, expect, it } from 'vitest'

import { readPostgresPoolConfig } from './client.ts'

describe('readPostgresPoolConfig', () => {
  it('uses bounded production-safe defaults', () => {
    expect(readPostgresPoolConfig('postgres://localhost/ark', {})).toMatchObject({
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 30_000,
      keepAlive: true,
      application_name: 'ark-api',
    })
  })

  it('reads valid pool settings and ignores invalid numeric overrides', () => {
    expect(
      readPostgresPoolConfig('postgres://localhost/ark', {
        DATABASE_POOL_SIZE: '12',
        DATABASE_CONNECT_TIMEOUT_MS: '7000',
        DATABASE_IDLE_TIMEOUT_MS: '-1',
        DATABASE_STATEMENT_TIMEOUT_MS: '45000',
        PGSSLMODE: 'no-verify',
      }),
    ).toMatchObject({
      max: 12,
      connectionTimeoutMillis: 7_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 45_000,
      ssl: { rejectUnauthorized: false },
    })
  })
})
