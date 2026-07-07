import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root (two levels above this file: apps/sandbox → repo root). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
