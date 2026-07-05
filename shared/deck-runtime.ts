import {
  getApprovedRuntimeAssetUrls,
  hasCustomJsMarker,
  hasRevealMarker,
  hasRevealStructure,
  type ApprovedRuntimeEntry,
  type RuntimeAssetKind,
} from './deck-runtime-registry.ts'

export type DeckRuntimeMode = 'static' | 'reveal' | 'custom-js'

export type DeckRuntimePolicy = {
  mode: DeckRuntimeMode
  csp: string
  previewSandbox: string
  thumbnailSandbox: string
  allowsDeckScripts: boolean
}

const PREVIEW_SANDBOX = 'allow-scripts'
const THUMBNAIL_SANDBOX = ''

const BLOCKED_SANDBOX_FEATURES = [
  'allow-same-origin',
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-modals',
  'allow-pointer-lock',
  'allow-presentation',
] as const

export type RuntimeCspOptions = {
  assetOrigin?: string | null
}

function buildDeckCsp(
  options: { scriptSources?: string[]; styleSources?: string[]; fontSources?: string[] } = {},
) {
  const scriptSources = ["'unsafe-inline'", ...(options.scriptSources ?? [])]
  const styleSources = ["'unsafe-inline'", ...(options.styleSources ?? [])]
  const fontSources = ['data:', ...(options.fontSources ?? [])]

  return [
    "default-src 'none'",
    `script-src ${scriptSources.join(' ')}`,
    `style-src ${styleSources.join(' ')}`,
    'img-src data: blob:',
    `font-src ${fontSources.join(' ')}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "child-src 'none'",
    "manifest-src 'none'",
  ].join('; ')
}

export const STRICT_DECK_CSP = buildDeckCsp()

export function detectRuntimeModeFromDocument(doc: Document): DeckRuntimeMode {
  if (hasCustomJsMarker(doc)) {
    return 'custom-js'
  }

  if (hasRevealMarker(doc) || hasRevealStructure(doc)) {
    return 'reveal'
  }

  return 'static'
}

export function detectRuntimeMode(html: string): DeckRuntimeMode {
  if (!html.trim()) {
    return 'static'
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  return detectRuntimeModeFromDocument(doc)
}

export function runtimeModeAllowsDeckScripts(mode: DeckRuntimeMode) {
  return mode === 'custom-js'
}

export function runtimeModeToBridgePreviewMode(mode: DeckRuntimeMode): 'css-only' | 'full-js' {
  return mode === 'custom-js' ? 'full-js' : 'css-only'
}

function runtimeModeToApprovedRuntimeMode(
  mode: DeckRuntimeMode,
): ApprovedRuntimeEntry['runtimeMode'] | null {
  return mode === 'static' ? null : mode
}

function getCurrentOrigin() {
  const origin = globalThis.location?.origin

  if (!origin || origin === 'null') {
    return null
  }

  return origin
}

function resolveAssetOrigin(options: RuntimeCspOptions = {}) {
  const configured = options.assetOrigin?.trim().replace(/\/+$/, '')

  if (configured) {
    return configured
  }

  return getCurrentOrigin()
}

export function toAbsoluteRuntimeAssetSource(source: string, options: RuntimeCspOptions = {}) {
  const origin = resolveAssetOrigin(options)

  if (!origin) {
    return null
  }

  try {
    return new URL(source, `${origin}/`).href
  } catch {
    return null
  }
}

export function getRuntimeAssetCspSources(
  mode: DeckRuntimeMode,
  kind: RuntimeAssetKind,
  options: RuntimeCspOptions = {},
) {
  const runtimeMode = runtimeModeToApprovedRuntimeMode(mode)

  if (!runtimeMode) {
    return []
  }

  return getApprovedRuntimeAssetUrls({ runtimeMode, kind })
    .map((source) => toAbsoluteRuntimeAssetSource(source, options))
    .filter((source): source is string => Boolean(source))
}

export function getRuntimePolicy(
  mode: DeckRuntimeMode,
  options: RuntimeCspOptions = {},
): DeckRuntimePolicy {
  return {
    mode,
    csp: getRuntimeCsp(mode, options),
    previewSandbox: PREVIEW_SANDBOX,
    thumbnailSandbox: THUMBNAIL_SANDBOX,
    allowsDeckScripts: runtimeModeAllowsDeckScripts(mode),
  }
}

export function getPreviewSandbox(mode: DeckRuntimeMode) {
  return getRuntimePolicy(mode).previewSandbox
}

export function getThumbnailSandbox() {
  return THUMBNAIL_SANDBOX
}

export function getRuntimeCsp(mode: DeckRuntimeMode, options: RuntimeCspOptions = {}) {
  const scriptSources = getRuntimeAssetCspSources(mode, 'script', options)
  const styleSources = getRuntimeAssetCspSources(mode, 'stylesheet', options)
  const fontSources = getRuntimeAssetCspSources(mode, 'font', options)

  if (scriptSources.length === 0 && styleSources.length === 0 && fontSources.length === 0) {
    return STRICT_DECK_CSP
  }

  return buildDeckCsp({ scriptSources, styleSources, fontSources })
}

export function getBlockedSandboxFeatures() {
  return [...BLOCKED_SANDBOX_FEATURES]
}

function escapeCspForMetaAttribute(csp: string) {
  return csp.replace(/"/g, '&quot;')
}

export function buildCspMetaTag(csp: string) {
  return `<meta http-equiv="Content-Security-Policy" content="${escapeCspForMetaAttribute(csp)}">`
}

export function injectRuntimeCsp(
  html: string,
  mode: DeckRuntimeMode,
  options: RuntimeCspOptions = {},
) {
  if (!html.trim()) {
    return html
  }

  const meta = buildCspMetaTag(getRuntimeCsp(mode, options))

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}\n${meta}`)
  }

  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}\n<head>\n${meta}\n</head>`)
  }

  return `<head>\n${meta}\n</head>\n${html}`
}
