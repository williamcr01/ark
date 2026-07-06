import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  configureRuntimeStylesheetMap,
  type RuntimeStylesheetMap,
} from './runtime-stylesheet-content.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const REVEAL_RUNTIME_ID = 'reveal.js'
const REVEAL_RUNTIME_VERSION = '5.1.0'

const REVEAL_RUNTIME_ASSET_PATHS = [
  'reveal.css',
  'reset.css',
  'theme/white.css',
  'theme/fonts/source-sans-pro/source-sans-pro.css',
] as const

function readRuntimeStylesheetFromDisk(runtimeId: string, version: string, assetPath: string) {
  const filePath = path.join(ROOT, 'runtimes', runtimeId, version, assetPath)

  if (!existsSync(filePath)) {
    return null
  }

  return readFileSync(filePath, 'utf8')
}

export function loadRevealRuntimeStylesheetsFromDisk(): RuntimeStylesheetMap {
  const map: RuntimeStylesheetMap = {}

  for (const assetPath of REVEAL_RUNTIME_ASSET_PATHS) {
    const css = readRuntimeStylesheetFromDisk(REVEAL_RUNTIME_ID, REVEAL_RUNTIME_VERSION, assetPath)

    if (css) {
      map[`${REVEAL_RUNTIME_ID}@${REVEAL_RUNTIME_VERSION}/${assetPath}`] = css
    }
  }

  return map
}

export function configureVitestRuntimeStylesheets() {
  configureRuntimeStylesheetMap(loadRevealRuntimeStylesheetsFromDisk())
}
