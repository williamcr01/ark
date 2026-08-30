import path from 'node:path'

import { REPO_ROOT } from './repo-root.ts'

export function resolveArkDataDir(...segments: string[]) {
  const configured = process.env.ARK_DATA_DIR?.trim()
  const root = configured ? path.resolve(configured) : path.resolve(REPO_ROOT, 'data')

  return path.join(root, ...segments)
}
