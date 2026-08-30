import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root (three levels above this file: packages/storage/fs → repo root). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
