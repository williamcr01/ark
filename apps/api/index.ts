import dotenv from 'dotenv'

import { REPO_ROOT } from './repo-root.ts'

dotenv.config({ path: `${REPO_ROOT}/.env` })

import { createApp } from './app.ts'
import { runStartupMigrations } from './startup.ts'

const port = Number(process.env.PORT ?? 8787)

async function main() {
  await runStartupMigrations()

  const app = createApp()
  app.listen(port, () => {
    console.log(`Ark API server listening on http://localhost:${port}`)
  })
}

void main()
