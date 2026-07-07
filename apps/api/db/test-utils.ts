import { newDb } from 'pg-mem'

import type { ConnectablePool } from './client.ts'

export function createMemoryPostgresPool() {
  const db = newDb({ noAstCoverageCheck: true })
  const { Pool } = db.adapters.createPg()

  return new Pool() as ConnectablePool
}
