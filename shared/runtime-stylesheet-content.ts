import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type RuntimeStylesheetMap = Record<string, string>

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let stylesheetMap: RuntimeStylesheetMap | null = null

export function configureRuntimeStylesheetMap(map: RuntimeStylesheetMap) {
  stylesheetMap = map
}

export function resetRuntimeStylesheetMap() {
  stylesheetMap = null
}

function buildStylesheetKey(runtimeId: string, version: string, assetPath: string) {
  return `${runtimeId}@${version}/${assetPath}`
}

function readRuntimeStylesheetFromDisk(runtimeId: string, version: string, assetPath: string) {
  const filePath = path.join(ROOT, 'runtimes', runtimeId, version, assetPath)

  if (!existsSync(filePath)) {
    return null
  }

  return readFileSync(filePath, 'utf8')
}

function isVitestEnvironment() {
  return typeof process !== 'undefined' && process.env.VITEST === 'true'
}

export function getApprovedRuntimeStylesheetContent(
  runtimeId: string,
  version: string,
  assetPath: string,
): string | null {
  const key = buildStylesheetKey(runtimeId, version, assetPath)

  if (stylesheetMap?.[key]) {
    return stylesheetMap[key]
  }

  if (isVitestEnvironment()) {
    return readRuntimeStylesheetFromDisk(runtimeId, version, assetPath)
  }

  return null
}

export async function loadRevealThumbnailStylesFromApi(
  assetOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
) {
  const runtimeId = 'reveal.js'
  const version = '5.1.0'
  const assetPaths = [
    'reveal.css',
    'reset.css',
    'theme/white.css',
    'theme/fonts/source-sans-pro/source-sans-pro.css',
  ]

  const entries = await Promise.all(
    assetPaths.map(async (assetPath) => {
      const url = `${assetOrigin.replace(/\/+$/, '')}/api/runtimes/${encodeURIComponent(runtimeId)}/${encodeURIComponent(version)}/${assetPath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')}`
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`Failed to load runtime stylesheet ${assetPath}: ${response.status}`)
      }

      return [buildStylesheetKey(runtimeId, version, assetPath), await response.text()] as const
    }),
  )

  configureRuntimeStylesheetMap(Object.fromEntries(entries))
}
