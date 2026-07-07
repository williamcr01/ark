import dotenv from 'dotenv'

import { REPO_ROOT } from './repo-root.ts'

dotenv.config({ path: `${REPO_ROOT}/.env` })

import {
  DEFAULT_SANDBOX_PORT,
  resolveApiOrigin,
  resolveSandboxOrigin,
} from '@ark/runtime-registry/sandbox-origin.ts'
import { createSandboxHost } from './sandbox-host.ts'
import { defaultPreviewSessionStore } from '@ark/api/preview-sessions.ts'

const port = Number(process.env.SANDBOX_PORT ?? DEFAULT_SANDBOX_PORT)
const apiOrigin = resolveApiOrigin()
const app = createSandboxHost({
  previewSessionStore: defaultPreviewSessionStore,
  apiOrigin,
})

app.listen(port, () => {
  console.log(`Ark sandbox host listening on ${resolveSandboxOrigin()}`)
})
