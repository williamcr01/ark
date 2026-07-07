export type RuntimeStylesheetMap = Record<string, string>

let stylesheetMap: RuntimeStylesheetMap | null = null
let preloadPromise: Promise<void> | null = null

export function configureRuntimeStylesheetMap(map: RuntimeStylesheetMap) {
  stylesheetMap = map
}

export function resetRuntimeStylesheetMap() {
  stylesheetMap = null
}

export function hasLoadedRevealThumbnailStyles() {
  return Boolean(stylesheetMap && Object.keys(stylesheetMap).length > 0)
}

function buildStylesheetKey(runtimeId: string, version: string, assetPath: string) {
  return `${runtimeId}@${version}/${assetPath}`
}

export function getApprovedRuntimeStylesheetContent(
  runtimeId: string,
  version: string,
  assetPath: string,
): string | null {
  const key = buildStylesheetKey(runtimeId, version, assetPath)

  return stylesheetMap?.[key] ?? null
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

function isVitestEnvironment() {
  return typeof process !== 'undefined' && process.env.VITEST === 'true'
}

function isBrowserEnvironment() {
  return typeof window !== 'undefined'
}

export function startRevealThumbnailStylesPreload(options: { assetOrigin?: string | null } = {}) {
  if (!isBrowserEnvironment() || isVitestEnvironment() || hasLoadedRevealThumbnailStyles()) {
    return
  }

  if (preloadPromise) {
    return
  }

  const assetOrigin = options.assetOrigin?.trim() || window.location.origin

  preloadPromise = loadRevealThumbnailStylesFromApi(assetOrigin)
    .catch(() => {
      // Thumbnail generation falls back to runtime <link> tags and reveal CSP.
    })
    .finally(() => {
      preloadPromise = null
    })
}

export function waitForRevealThumbnailStylesPreload() {
  if (hasLoadedRevealThumbnailStyles()) {
    return Promise.resolve()
  }

  return preloadPromise ?? Promise.resolve()
}
