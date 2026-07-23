import dotenv from 'dotenv'

import { REPO_ROOT } from './repo-root.ts'

dotenv.config({ path: `${REPO_ROOT}/.env` })

import { createApp } from './app.ts'
import { warmModelCatalog } from './models.ts'
import { runStartupMigrations } from './startup.ts'
import { type ThumbnailService } from './thumbnails/service.ts'

const port = Number(process.env.PORT ?? 8787)

async function main() {
  await runStartupMigrations()
  await warmModelCatalog()

  const app = createApp()
  const server = app.listen(port, () => {
    console.log(`Ark API server listening on http://localhost:${port}`)
  })

  // Kill the shared headless Chromium pool on shutdown; the spawned browser is
  // unref'd, so without this every restart would orphan a Chromium process.
  const thumbnailService = app.locals.thumbnailService as ThumbnailService | undefined
  let shuttingDown = false

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    server.close()

    const closeThumbnails = thumbnailService?.close() ?? Promise.resolve()
    void closeThumbnails
      .catch(() => undefined)
      .finally(() => {
        process.kill(process.pid, signal)
      })
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => shutdown(signal))
  }
}

void main()
