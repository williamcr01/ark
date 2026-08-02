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

const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000
const DEFAULT_IDLE_TIMEOUT_MS = 30_000
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000

export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL?.trim()

  return databaseUrl || null
}

function readPositiveInteger(env: NodeJS.ProcessEnv, name: string, fallback?: number) {
  const raw = env[name]?.trim()

  if (!raw) {
    return fallback
  }

  const parsed = Number(raw)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
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

export function readPostgresPoolConfig(
  connectionString: string,
  env: NodeJS.ProcessEnv,
): PoolConfig {
  return {
    connectionString,
    max: readPositiveInteger(env, 'DATABASE_POOL_SIZE'),
    connectionTimeoutMillis: readPositiveInteger(
      env,
      'DATABASE_CONNECT_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MS,
    ),
    idleTimeoutMillis: readPositiveInteger(
      env,
      'DATABASE_IDLE_TIMEOUT_MS',
      DEFAULT_IDLE_TIMEOUT_MS,
    ),
    statement_timeout: readPositiveInteger(
      env,
      'DATABASE_STATEMENT_TIMEOUT_MS',
      DEFAULT_STATEMENT_TIMEOUT_MS,
    ),
    keepAlive: true,
    application_name: 'ark-api',
    ssl: readSslConfig(env),
  }
}

export function createPostgresPool(options: PostgresPoolOptions = {}): ConnectablePool {
  const env = options.env ?? process.env
  const connectionString = options.connectionString ?? readDatabaseUrl(env)

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to use Postgres persistence.')
  }

  const pool = new Pool(readPostgresPoolConfig(connectionString, env))
  pool.on('error', (error) => {
    console.error('Unexpected Postgres pool error.', error)
  })

  return pool as ConnectablePool
}
