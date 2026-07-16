import manifest from '../../runtimes/manifest.json'

export type RuntimeAssetKind = 'script' | 'stylesheet' | 'font'

export type ApprovedRuntimeAsset = {
  path: string
  kind: RuntimeAssetKind
  sha256: string
  size: number
}

export type ApprovedRuntimeMarkers = {
  arkRuntime?: string[]
  arkDeck?: string[]
  arkPreview?: string[]
  arkRuntimeLib?: string[]
}

export type ApprovedRuntimeEntry = {
  id: string
  version: string
  runtimeMode: 'reveal' | 'custom-js'
  license: string
  source: string
  deprecated?: boolean
  supersededBy?: { id: string; version: string }
  previewMode: 'css-only' | 'full-js'
  allowsDeckScripts: boolean
  allowedGlobals?: string[]
  markers: ApprovedRuntimeMarkers
  structureHints?: string[]
  requiredAssets: {
    css?: string[]
    js?: string[]
  }
  assets: ApprovedRuntimeAsset[]
}

export type RuntimeAssetRef = {
  runtimeId: string
  version: string
  assetPath: string
}

export type DeckRuntimeLibraryMarkers = {
  arkRuntimeLib: string | null
  arkRuntimeVersion: string | null
}

export type DeckRuntimeAddonMarkers = {
  arkRuntimeAddonLib: string | null
  arkRuntimeAddonVersion: string | null
}

export type DeckRuntimeMarkers = DeckRuntimeLibraryMarkers & DeckRuntimeAddonMarkers

export const RUNTIME_ASSET_API_PREFIX = '/api/runtimes'

/** Built-in custom-js markers managed by Ark (not tied to a vendored library). */
export const BUILTIN_CUSTOM_JS_MARKERS = {
  arkDeck: ['nav'],
  arkPreview: ['full-js'],
  arkRuntime: ['custom-js'],
} as const

const APPROVED_RUNTIMES = manifest.runtimes as ApprovedRuntimeEntry[]

const runtimeByKey = new Map<string, ApprovedRuntimeEntry>()

for (const entry of APPROVED_RUNTIMES) {
  runtimeByKey.set(`${entry.id}@${entry.version}`, entry)
}

const allowedMarkerValues = {
  arkDeck: new Set<string>([...BUILTIN_CUSTOM_JS_MARKERS.arkDeck]),
  arkPreview: new Set<string>([...BUILTIN_CUSTOM_JS_MARKERS.arkPreview]),
  arkRuntime: new Set<string>([...BUILTIN_CUSTOM_JS_MARKERS.arkRuntime]),
  arkRuntimeLib: new Set<string>(),
}

for (const entry of APPROVED_RUNTIMES) {
  for (const value of entry.markers.arkDeck ?? []) {
    allowedMarkerValues.arkDeck.add(value)
  }

  for (const value of entry.markers.arkRuntime ?? []) {
    allowedMarkerValues.arkRuntime.add(value)
  }

  for (const value of entry.markers.arkRuntimeLib ?? []) {
    allowedMarkerValues.arkRuntimeLib.add(value)
  }
}

export function getApprovedRuntimes() {
  return [...APPROVED_RUNTIMES]
}

export function getApprovedRuntime(runtimeId: string, version: string) {
  return runtimeByKey.get(`${runtimeId}@${version}`) ?? null
}

export function getApprovedRuntimeVersions(runtimeId: string) {
  return APPROVED_RUNTIMES.filter((entry) => entry.id === runtimeId).map((entry) => entry.version)
}

export function buildRuntimeAssetUrl(runtimeId: string, version: string, assetPath: string) {
  const encodedId = encodeURIComponent(runtimeId)
  const encodedVersion = encodeURIComponent(version)
  const encodedAsset = assetPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `${RUNTIME_ASSET_API_PREFIX}/${encodedId}/${encodedVersion}/${encodedAsset}`
}

export function parseRuntimeAssetUrl(url: string | null | undefined): RuntimeAssetRef | null {
  const trimmed = url?.trim()

  if (!trimmed?.startsWith(`${RUNTIME_ASSET_API_PREFIX}/`)) {
    return null
  }

  const remainder = trimmed.slice(RUNTIME_ASSET_API_PREFIX.length + 1)
  const segments = remainder.split('/')

  if (segments.length < 3) {
    return null
  }

  const runtimeId = decodeURIComponent(segments[0] ?? '')
  const version = decodeURIComponent(segments[1] ?? '')
  const assetPath = segments
    .slice(2)
    .map((segment) => decodeURIComponent(segment))
    .join('/')

  if (!runtimeId || !version || !assetPath) {
    return null
  }

  return { runtimeId, version, assetPath }
}

export function isApprovedRuntimeAssetUrl(url: string | null | undefined, kind?: RuntimeAssetKind) {
  const ref = parseRuntimeAssetUrl(url)

  if (!ref) {
    return false
  }

  const runtime = getApprovedRuntime(ref.runtimeId, ref.version)

  if (!runtime) {
    return false
  }

  return runtime.assets.some(
    (asset) => asset.path === ref.assetPath && (!kind || asset.kind === kind),
  )
}

export function hasApprovedRevealRuntimeInDocument(doc: Document) {
  return [...doc.querySelectorAll('script[src]')].some((script) => {
    const ref = parseRuntimeAssetUrl(script.getAttribute('src'))

    if (!ref || ref.runtimeId !== 'reveal.js') {
      return false
    }

    const lookup = lookupRuntimeAsset(ref)

    return lookup?.asset.kind === 'script'
  })
}

export function hasApprovedRevealRuntimeInHtml(html: string) {
  if (!html.trim()) {
    return false
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  return hasApprovedRevealRuntimeInDocument(doc)
}

export function lookupRuntimeAsset(ref: RuntimeAssetRef) {
  const runtime = getApprovedRuntime(ref.runtimeId, ref.version)

  if (!runtime) {
    return null
  }

  const asset = runtime.assets.find((entry) => entry.path === ref.assetPath)

  if (!asset) {
    return null
  }

  return { runtime, asset }
}

export function getApprovedRuntimeAssetUrls(
  options: { runtimeMode?: ApprovedRuntimeEntry['runtimeMode']; kind?: RuntimeAssetKind } = {},
) {
  return APPROVED_RUNTIMES.filter(
    (runtime) => !options.runtimeMode || runtime.runtimeMode === options.runtimeMode,
  ).flatMap((runtime) =>
    runtime.assets
      .filter((asset) => !options.kind || asset.kind === options.kind)
      .map((asset) => buildRuntimeAssetUrl(runtime.id, runtime.version, asset.path)),
  )
}

export function readDeckRuntimeLibraryMarkers(doc: Document): DeckRuntimeLibraryMarkers {
  const html = doc.documentElement
  const body = doc.body

  return {
    arkRuntimeLib:
      html?.getAttribute('data-ark-runtime-lib') ??
      body?.getAttribute('data-ark-runtime-lib') ??
      null,
    arkRuntimeVersion:
      html?.getAttribute('data-ark-runtime-version') ??
      body?.getAttribute('data-ark-runtime-version') ??
      null,
  }
}

export function readDeckRuntimeAddonMarkers(doc: Document): DeckRuntimeAddonMarkers {
  const html = doc.documentElement
  const body = doc.body

  return {
    arkRuntimeAddonLib:
      html?.getAttribute('data-ark-runtime-addon-lib') ??
      body?.getAttribute('data-ark-runtime-addon-lib') ??
      null,
    arkRuntimeAddonVersion:
      html?.getAttribute('data-ark-runtime-addon-version') ??
      body?.getAttribute('data-ark-runtime-addon-version') ??
      null,
  }
}

export function readDeckRuntimeMarkers(doc: Document): DeckRuntimeMarkers {
  return {
    ...readDeckRuntimeLibraryMarkers(doc),
    ...readDeckRuntimeAddonMarkers(doc),
  }
}

export function deckUsesChartJsAddon(doc: Document) {
  const addonMarkers = readDeckRuntimeAddonMarkers(doc)

  if (!addonMarkers.arkRuntimeAddonLib || !addonMarkers.arkRuntimeAddonVersion) {
    return false
  }

  if (addonMarkers.arkRuntimeAddonLib !== 'chart.js') {
    return false
  }

  return (
    getApprovedRuntime(addonMarkers.arkRuntimeAddonLib, addonMarkers.arkRuntimeAddonVersion) !==
    null
  )
}

export function resolveDeckRuntimeAddons(doc: Document): ApprovedRuntimeEntry[] {
  const addons: ApprovedRuntimeEntry[] = []
  const addonMarkers = readDeckRuntimeAddonMarkers(doc)

  if (addonMarkers.arkRuntimeAddonLib && addonMarkers.arkRuntimeAddonVersion) {
    const runtime = getApprovedRuntime(
      addonMarkers.arkRuntimeAddonLib,
      addonMarkers.arkRuntimeAddonVersion,
    )

    if (runtime) {
      addons.push(runtime)
    }
  }

  return addons
}

export function readArkMarkerAttributes(doc: Document) {
  const html = doc.documentElement
  const body = doc.body

  return {
    arkDeck: html?.getAttribute('data-ark-deck') ?? body?.getAttribute('data-ark-deck') ?? null,
    arkPreview:
      html?.getAttribute('data-ark-preview') ?? body?.getAttribute('data-ark-preview') ?? null,
    arkRuntime:
      html?.getAttribute('data-ark-runtime') ?? body?.getAttribute('data-ark-runtime') ?? null,
    ...readDeckRuntimeLibraryMarkers(doc),
  }
}

export function isAllowedMarkerValue(
  attribute: 'arkDeck' | 'arkPreview' | 'arkRuntime' | 'arkRuntimeLib',
  value: string,
) {
  return allowedMarkerValues[attribute].has(value)
}

export function collectInvalidRuntimeMarkers(doc: Document) {
  const markers = readArkMarkerAttributes(doc)
  const invalid: Array<{ attribute: string; value: string }> = []

  if (markers.arkDeck && !isAllowedMarkerValue('arkDeck', markers.arkDeck)) {
    invalid.push({ attribute: 'data-ark-deck', value: markers.arkDeck })
  }

  if (markers.arkPreview && !isAllowedMarkerValue('arkPreview', markers.arkPreview)) {
    invalid.push({ attribute: 'data-ark-preview', value: markers.arkPreview })
  }

  if (markers.arkRuntime && !isAllowedMarkerValue('arkRuntime', markers.arkRuntime)) {
    invalid.push({ attribute: 'data-ark-runtime', value: markers.arkRuntime })
  }

  if (markers.arkRuntimeLib && !isAllowedMarkerValue('arkRuntimeLib', markers.arkRuntimeLib)) {
    invalid.push({ attribute: 'data-ark-runtime-lib', value: markers.arkRuntimeLib })
  }

  return invalid
}

function markerMatches(values: readonly string[], actual: string | null) {
  return Boolean(actual && values.includes(actual))
}

export function hasCustomJsMarker(doc: Document) {
  for (const element of [doc.documentElement, doc.body]) {
    if (!element) {
      continue
    }

    if (markerMatches(BUILTIN_CUSTOM_JS_MARKERS.arkDeck, element.getAttribute('data-ark-deck'))) {
      return true
    }

    if (
      markerMatches(BUILTIN_CUSTOM_JS_MARKERS.arkPreview, element.getAttribute('data-ark-preview'))
    ) {
      return true
    }

    if (
      markerMatches(BUILTIN_CUSTOM_JS_MARKERS.arkRuntime, element.getAttribute('data-ark-runtime'))
    ) {
      return true
    }
  }

  return false
}

export function hasRevealMarker(doc: Document) {
  for (const entry of APPROVED_RUNTIMES) {
    if (entry.runtimeMode !== 'reveal') {
      continue
    }

    for (const element of [doc.documentElement, doc.body]) {
      if (!element) {
        continue
      }

      const arkRuntime = element.getAttribute('data-ark-runtime')
      const arkDeck = element.getAttribute('data-ark-deck')

      if (entry.markers.arkRuntime?.includes(arkRuntime ?? '')) {
        return true
      }

      if (entry.markers.arkDeck?.includes(arkDeck ?? '')) {
        return true
      }
    }
  }

  return false
}

export function hasRevealStructure(doc: Document) {
  for (const entry of APPROVED_RUNTIMES) {
    if (entry.runtimeMode !== 'reveal') {
      continue
    }

    for (const selector of entry.structureHints ?? []) {
      const match = doc.querySelector(selector)

      if (match) {
        return true
      }
    }
  }

  return false
}

export function resolveDeckApprovedRuntime(doc: Document): ApprovedRuntimeEntry | null {
  const libraryMarkers = readDeckRuntimeLibraryMarkers(doc)

  if (libraryMarkers.arkRuntimeLib && libraryMarkers.arkRuntimeVersion) {
    return getApprovedRuntime(libraryMarkers.arkRuntimeLib, libraryMarkers.arkRuntimeVersion)
  }

  if (hasRevealMarker(doc) || hasRevealStructure(doc)) {
    return (
      APPROVED_RUNTIMES.find((entry) => entry.runtimeMode === 'reveal' && !entry.deprecated) ?? null
    )
  }

  return null
}

export function collectRuntimeAssetReferences(doc: Document) {
  const refs = new Set<string>()

  for (const element of doc.querySelectorAll('[src], [href], link[rel="stylesheet"]')) {
    for (const attribute of ['src', 'href'] as const) {
      const value = element.getAttribute(attribute)

      if (value?.startsWith(`${RUNTIME_ASSET_API_PREFIX}/`)) {
        refs.add(value.trim())
      }
    }
  }

  return [...refs].sort()
}

function collectDeclaredDeckRuntimes(
  libraryMarkers: DeckRuntimeLibraryMarkers,
  addonMarkers: DeckRuntimeAddonMarkers = {
    arkRuntimeAddonLib: null,
    arkRuntimeAddonVersion: null,
  },
) {
  const runtimes: ApprovedRuntimeEntry[] = []

  if (libraryMarkers.arkRuntimeLib && libraryMarkers.arkRuntimeVersion) {
    const runtime = getApprovedRuntime(
      libraryMarkers.arkRuntimeLib,
      libraryMarkers.arkRuntimeVersion,
    )

    if (runtime) {
      runtimes.push(runtime)
    }
  }

  if (addonMarkers.arkRuntimeAddonLib && addonMarkers.arkRuntimeAddonVersion) {
    const runtime = getApprovedRuntime(
      addonMarkers.arkRuntimeAddonLib,
      addonMarkers.arkRuntimeAddonVersion,
    )

    if (runtime && !runtimes.some((entry) => entry.id === runtime.id)) {
      runtimes.push(runtime)
    }
  }

  return runtimes
}

function runtimeMatchesDeclaredVersion(
  runtimeId: string,
  version: string,
  declaredRuntimes: ApprovedRuntimeEntry[],
) {
  return declaredRuntimes.some((runtime) => runtime.id === runtimeId && runtime.version === version)
}

function isIncompleteRuntimeMarkerPair(library: string | null, version: string | null) {
  return Boolean(library) !== Boolean(version)
}

export function validateRuntimeAssetReferences(
  references: string[],
  libraryMarkers: DeckRuntimeLibraryMarkers,
  addonMarkers: DeckRuntimeAddonMarkers = {
    arkRuntimeAddonLib: null,
    arkRuntimeAddonVersion: null,
  },
) {
  const issues: Array<{
    code: 'unapproved_runtime_asset' | 'runtime_version_mismatch' | 'missing_runtime_assets'
    message: string
    severity: 'error'
  }> = []

  if (
    isIncompleteRuntimeMarkerPair(libraryMarkers.arkRuntimeLib, libraryMarkers.arkRuntimeVersion)
  ) {
    issues.push({
      code: 'runtime_version_mismatch',
      message:
        'Runtime library markers must include both data-ark-runtime-lib and data-ark-runtime-version.',
      severity: 'error',
    })
  }

  if (
    isIncompleteRuntimeMarkerPair(
      addonMarkers.arkRuntimeAddonLib,
      addonMarkers.arkRuntimeAddonVersion,
    )
  ) {
    issues.push({
      code: 'runtime_version_mismatch',
      message:
        'Addon runtime markers must include both data-ark-runtime-addon-lib and data-ark-runtime-addon-version.',
      severity: 'error',
    })
  }

  const referencedAssets = new Map<string, Set<string>>()
  const declaredRuntimes = collectDeclaredDeckRuntimes(libraryMarkers, addonMarkers)

  for (const reference of references) {
    const ref = parseRuntimeAssetUrl(reference)

    if (!ref) {
      issues.push({
        code: 'unapproved_runtime_asset',
        message: `Unapproved runtime asset reference: ${reference}`,
        severity: 'error',
      })
      continue
    }

    const lookup = lookupRuntimeAsset(ref)

    if (!lookup) {
      if (
        declaredRuntimes.some(
          (runtime) => runtime.id === ref.runtimeId && runtime.version !== ref.version,
        )
      ) {
        issues.push({
          code: 'runtime_version_mismatch',
          message: `Runtime asset ${reference} does not match a declared runtime version for ${ref.runtimeId}.`,
          severity: 'error',
        })
        continue
      }

      issues.push({
        code: 'unapproved_runtime_asset',
        message: `Runtime asset is not in the approved registry: ${reference}`,
        severity: 'error',
      })
      continue
    }

    const key = `${ref.runtimeId}@${ref.version}`
    const paths = referencedAssets.get(key) ?? new Set<string>()
    paths.add(ref.assetPath)
    referencedAssets.set(key, paths)

    if (
      declaredRuntimes.length > 0 &&
      !runtimeMatchesDeclaredVersion(ref.runtimeId, ref.version, declaredRuntimes)
    ) {
      issues.push({
        code: 'runtime_version_mismatch',
        message: `Runtime asset ${reference} does not match any declared runtime library version.`,
        severity: 'error',
      })
    }
  }

  for (const runtime of declaredRuntimes) {
    const key = `${runtime.id}@${runtime.version}`
    const paths = referencedAssets.get(key) ?? new Set<string>()
    const required = [...(runtime.requiredAssets.css ?? []), ...(runtime.requiredAssets.js ?? [])]
    const missing = required.filter((assetPath) => !paths.has(assetPath))

    if (missing.length > 0) {
      issues.push({
        code: 'missing_runtime_assets',
        message: `Missing required runtime assets for ${runtime.id}@${runtime.version}: ${missing.join(', ')}.`,
        severity: 'error',
      })
    }
  }

  if (libraryMarkers.arkRuntimeLib && libraryMarkers.arkRuntimeVersion) {
    const runtime = getApprovedRuntime(
      libraryMarkers.arkRuntimeLib,
      libraryMarkers.arkRuntimeVersion,
    )

    if (!runtime) {
      issues.push({
        code: 'unapproved_runtime_asset',
        message: `Declared runtime library ${libraryMarkers.arkRuntimeLib}@${libraryMarkers.arkRuntimeVersion} is not in the approved registry.`,
        severity: 'error',
      })
    }
  }

  if (addonMarkers.arkRuntimeAddonLib && addonMarkers.arkRuntimeAddonVersion) {
    const runtime = getApprovedRuntime(
      addonMarkers.arkRuntimeAddonLib,
      addonMarkers.arkRuntimeAddonVersion,
    )

    if (!runtime) {
      issues.push({
        code: 'unapproved_runtime_asset',
        message: `Declared addon runtime ${addonMarkers.arkRuntimeAddonLib}@${addonMarkers.arkRuntimeAddonVersion} is not in the approved registry.`,
        severity: 'error',
      })
    }
  }

  return issues
}

export function buildRuntimeRegistryPromptSection() {
  const lines = [
    'Approved deck runtimes (use only pinned Ark-served assets — never external CDNs):',
  ]

  for (const runtime of APPROVED_RUNTIMES) {
    const cssAssets = runtime.requiredAssets.css ?? []
    const jsAssets = runtime.requiredAssets.js ?? []
    const markerParts = [
      runtime.markers.arkRuntime?.length
        ? `data-ark-runtime="${runtime.markers.arkRuntime.join('" or "')}"`
        : null,
      `data-ark-runtime-lib="${runtime.id}"`,
      `data-ark-runtime-version="${runtime.version}"`,
    ].filter(Boolean)

    lines.push(
      `- ${runtime.id}@${runtime.version} (${runtime.runtimeMode}): set ${markerParts.join(', ')} on <html>.`,
    )

    if (runtime.id === 'chart.js') {
      lines.push(
        `  - Reveal decks: also set data-ark-runtime-addon-lib="${runtime.id}" and data-ark-runtime-addon-version="${runtime.version}" on <html>.`,
      )
    }

    for (const assetPath of [...cssAssets, ...jsAssets]) {
      lines.push(`  - ${buildRuntimeAssetUrl(runtime.id, runtime.version, assetPath)}`)
    }
  }

  return lines.join('\n')
}

export function getRuntimeRegistrySummary() {
  return APPROVED_RUNTIMES.map((runtime) => ({
    id: runtime.id,
    version: runtime.version,
    runtimeMode: runtime.runtimeMode,
    deprecated: runtime.deprecated ?? false,
    previewMode: runtime.previewMode,
    allowsDeckScripts: runtime.allowsDeckScripts,
    assets: runtime.assets.map((asset) => ({
      path: asset.path,
      kind: asset.kind,
      url: buildRuntimeAssetUrl(runtime.id, runtime.version, asset.path),
      sha256: asset.sha256,
      size: asset.size,
    })),
  }))
}
