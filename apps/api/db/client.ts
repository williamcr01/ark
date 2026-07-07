import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg'

export type Queryable = {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

export type ReleasableClient = Queryable & {
  release: () => void
}

export type ConnectablePool = Queryable & {
  connect: () => Promise<ReleasableClient>
  end?: () => Promise<void>
}

export type PostgresPoolOptions = {
  connectionString?: string
  env?: NodeJS.ProcessEnv
}

export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL?.trim()

  return databaseUrl || null
}

function readPoolSize(env: NodeJS.ProcessEnv) {
  const raw = env.DATABASE_POOL_SIZE?.trim()

  if (!raw) {
    return undefined
  }

  const parsed = Number(raw)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function readSslConfig(env: NodeJS.ProcessEnv): PoolConfig['ssl'] {
  const raw = env.PGSSLMODE?.trim() || env.DATABASE_SSL?.trim()
  const value = raw?.toLowerCase()

  if (!value || value === 'disable' || value === 'false' || value === '0') {
    return undefined
  }

  if (value === 'no-verify') {
    return { rejectUnauthorized: false }
  }

  if (value === 'require' || value === 'true' || value === '1') {
    return { rejectUnauthorized: true }
  }

  throw new Error('Unsupported Postgres SSL mode. Use PGSSLMODE=disable, require, or no-verify.')
}

export function createPostgresPool(options: PostgresPoolOptions = {}): ConnectablePool {
  const env = options.env ?? process.env
  const connectionString = options.connectionString ?? readDatabaseUrl(env)

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to use the Postgres deck store.')
  }

  return new Pool({
    connectionString,
    max: readPoolSize(env),
    ssl: readSslConfig(env),
  }) as ConnectablePool
}
