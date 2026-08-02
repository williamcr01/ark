import dotenv from 'dotenv'

import { REPO_ROOT } from './repo-root.ts'

dotenv.config({ path: `${REPO_ROOT}/.env` })

import { createApp } from './app.ts'
import { createPostgresPool, readDatabaseUrl, type ConnectablePool } from './db/client.ts'
import { warmModelCatalog } from './models.ts'
import { runStartupMigrations } from './startup.ts'
import { type ThumbnailService } from './thumbnails/service.ts'

const port = Number(process.env.PORT ?? 8787)

async function main() {
  const databasePool: ConnectablePool | null = readDatabaseUrl() ? createPostgresPool() : null

  try {
    await runStartupMigrations(process.env, databasePool ?? undefined)
  } catch (error) {
    await databasePool?.end?.()
    throw error
  }

  const app = createApp({ databasePool })
  const server = app.listen(port, () => {
    console.log(`Ark API server listening on http://localhost:${port}`)
  })

  void warmModelCatalog().catch(() => undefined)

  // Kill the shared headless Chromium pool on shutdown; the spawned browser is
  // unref'd, so without this every restart would orphan a Chromium process.
  const thumbnailService = app.locals.thumbnailService as ThumbnailService | undefined
  let shuttingDown = false

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    const closeServices = new Promise<void>((resolve) => {
      server.close(() => {
        void Promise.all([
          thumbnailService?.close() ?? Promise.resolve(),
          databasePool?.end?.() ?? Promise.resolve(),
        ]).finally(resolve)
      })
    })

    // Ctrl+C under tsx watch must exit immediately or tsx force-kills noisily.
    // SIGTERM (tsx reload / stop) still waits briefly for Chromium teardown.
    if (signal === 'SIGINT') {
      void closeServices.catch(() => undefined)
      process.exit(0)
    }

    const timeout = new Promise((resolve) => setTimeout(resolve, 1500))
    void Promise.race([closeServices.catch(() => undefined), timeout]).finally(() => {
      process.exit(0)
    })
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => shutdown(signal))
  }
}

void main()
