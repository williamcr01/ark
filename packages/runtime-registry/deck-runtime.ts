import {
  buildRuntimeAssetUrl,
  getApprovedRuntimeAssetUrls,
  hasApprovedRevealRuntimeInHtml,
  hasCustomJsMarker,
  hasRevealMarker,
  hasRevealStructure,
  deckUsesChartJsAddon,
  resolveDeckRuntimeAddons,
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
  /**
   * When set for static/reveal modes, `script-src` uses `'nonce-...'` instead of
   * `'unsafe-inline'`. Ignored for custom-js (deck-authored inline scripts need
   * `'unsafe-inline'`; a nonce would disable it).
   */
  nonce?: string | null
}

function buildDeckCsp(
  options: {
    scriptSources?: string[]
    styleSources?: string[]
    fontSources?: string[]
    /**
     * When true, omit `'unsafe-inline'` from script-src (caller must supply a
     * nonce or other script allowlist entry). Style-src always keeps
     * `'unsafe-inline'`.
     */
    omitUnsafeInlineScript?: boolean
  } = {},
) {
  const scriptSources = [
    ...(options.omitUnsafeInlineScript ? [] : ["'unsafe-inline'"]),
    ...(options.scriptSources ?? []),
  ]
  const styleSources = ["'unsafe-inline'", ...(options.styleSources ?? [])]
  const fontSources = ['data:', ...(options.fontSources ?? [])]

  if (scriptSources.length === 0) {
    scriptSources.push("'none'")
  }

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

/** Baseline CSP for static decks without a per-render nonce (legacy / export). */
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

export function documentAllowsDeckInitScripts(doc: Document) {
  if (hasCustomJsMarker(doc)) {
    return true
  }

  if ((hasRevealMarker(doc) || hasRevealStructure(doc)) && deckUsesChartJsAddon(doc)) {
    return true
  }

  return false
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

function getApprovedRuntimeAssetCspSourcesForEntries(
  runtimes: ApprovedRuntimeEntry[],
  kind: RuntimeAssetKind,
  options: RuntimeCspOptions = {},
) {
  return runtimes
    .flatMap((runtime) =>
      runtime.assets
        .filter((asset) => asset.kind === kind)
        .map((asset) => buildRuntimeAssetUrl(runtime.id, runtime.version, asset.path)),
    )
    .map((source) => toAbsoluteRuntimeAssetSource(source, options))
    .filter((source): source is string => Boolean(source))
}

export function runtimeModeToBridgePreviewMode(
  mode: DeckRuntimeMode,
  options: { usesRevealAdapter?: boolean } = {},
): 'css-only' | 'full-js' {
  if (mode === 'custom-js' || (mode === 'reveal' && options.usesRevealAdapter)) {
    return 'full-js'
  }

  return 'css-only'
}

export function usesRevealRuntimeAdapter(html: string) {
  return detectRuntimeMode(html) === 'reveal' && hasApprovedRevealRuntimeInHtml(html)
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

export function getDeckRuntimeCsp(
  doc: Document,
  mode: DeckRuntimeMode,
  options: RuntimeCspOptions = {},
) {
  return getRuntimeCsp(mode, {
    ...options,
    addonRuntimes: resolveDeckRuntimeAddons(doc),
    allowDeckInlineScripts: documentAllowsDeckInitScripts(doc),
  })
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

export type RuntimeCspBuildOptions = RuntimeCspOptions & {
  addonRuntimes?: ApprovedRuntimeEntry[]
  allowDeckInlineScripts?: boolean
}

function shouldUseScriptNonce(mode: DeckRuntimeMode, options: RuntimeCspBuildOptions = {}) {
  if (options.allowDeckInlineScripts) {
    return false
  }

  return Boolean(options.nonce) && mode !== 'custom-js'
}

export function getRuntimeCsp(mode: DeckRuntimeMode, options: RuntimeCspBuildOptions = {}) {
  const addonRuntimes = options.addonRuntimes ?? []
  const scriptSources = [
    ...getRuntimeAssetCspSources(mode, 'script', options),
    ...getApprovedRuntimeAssetCspSourcesForEntries(addonRuntimes, 'script', options),
  ]
  const styleSources = [
    ...getRuntimeAssetCspSources(mode, 'stylesheet', options),
    ...getApprovedRuntimeAssetCspSourcesForEntries(addonRuntimes, 'stylesheet', options),
  ]
  const fontSources = [
    ...getRuntimeAssetCspSources(mode, 'font', options),
    ...getApprovedRuntimeAssetCspSourcesForEntries(addonRuntimes, 'font', options),
  ]
  const useNonce = shouldUseScriptNonce(mode, options)
  const nonceSource = useNonce && options.nonce ? [`'nonce-${options.nonce}'`] : []

  if (
    scriptSources.length === 0 &&
    styleSources.length === 0 &&
    fontSources.length === 0 &&
    !useNonce
  ) {
    return STRICT_DECK_CSP
  }

  return buildDeckCsp({
    scriptSources: [...nonceSource, ...scriptSources],
    styleSources,
    fontSources,
    omitUnsafeInlineScript: useNonce,
  })
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
