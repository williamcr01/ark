import { isApprovedRuntimeAssetUrl } from './deck-runtime-registry.ts'
import {
  DECK_FONT_ROLES,
  isApprovedDeckFontId,
  type DeckFontSelection,
} from './deck-font-registry.ts'
import {
  runtimeModeAllowsDeckScripts,
  runtimeModeToBridgePreviewMode,
  type DeckRuntimeMode,
} from './deck-runtime.ts'

export const DECK_RUNTIME_MANIFEST_SCHEMA_VERSION = 1

export const DEFAULT_DECK_ASPECT_RATIO = '16:9' as const

export type DeckManifestStructure = 'plain' | 'reveal' | 'unknown'

export type DeckRuntimeManifestAsset = {
  kind: string
  url: string
  slideIndex?: number
  approved: boolean
}

export type DeckRuntimeManifestScripts = {
  inline: number
  external: number
  allowed: boolean
}

export type DeckRuntimeManifestNetwork = {
  externalUrls: string[]
  connectAllowed: false
}

export type DeckRuntimeManifestValidation = {
  valid: boolean
  warnings: number
  errors: number
}

export type DeckManifestFonts = {
  /** Per-role registry ids declared by the deck, or null where it declared none. */
  selection: DeckFontSelection
  /** Declared ids the registry does not know; these will not survive PPTX export. */
  unknown: string[]
}

export type DeckRuntimeManifestApprovedRuntime = {
  id: string
  version: string
}

export type DeckRuntimeManifest = {
  schemaVersion: typeof DECK_RUNTIME_MANIFEST_SCHEMA_VERSION
  runtimeMode: DeckRuntimeMode
  approvedRuntime?: DeckRuntimeManifestApprovedRuntime
  previewMode: 'css-only' | 'full-js'
  structure: DeckManifestStructure
  slideSelector: string | null
  slideCount: number
  aspectRatio: typeof DEFAULT_DECK_ASPECT_RATIO | string
  scripts: DeckRuntimeManifestScripts
  assets: DeckRuntimeManifestAsset[]
  network: DeckRuntimeManifestNetwork
  validation: DeckRuntimeManifestValidation
  usesRevealAdapter: boolean
  fonts: DeckManifestFonts
  warnings: string[]
}

export type DeckManifestValidationIssue = {
  code: string
  message: string
  severity: 'error' | 'warning'
}

export type DeckManifestValidationInput = {
  valid: boolean
  slideCount: number
  scripts: Array<{ inline: boolean; src?: string }>
  externalUrls: string[]
  runtimeMode: DeckRuntimeMode
  approvedRuntimeId: string | null
  approvedRuntimeVersion: string | null
  issues: DeckManifestValidationIssue[]
}

export type DeckManifestParseInput = {
  structure: DeckManifestStructure
  slideSelector: string | null
  slideCount: number
  assets: Array<{ kind: string; url: string; slideIndex?: number }>
  fonts?: DeckFontSelection
}

const EMPTY_FONT_SELECTION: DeckFontSelection = { display: null, body: null, mono: null }

function summarizeManifestFonts(selection: DeckFontSelection = EMPTY_FONT_SELECTION) {
  const unknown = DECK_FONT_ROLES.map((role) => selection[role]).filter(
    (id): id is string => Boolean(id) && !isApprovedDeckFontId(id),
  )

  return { selection, unknown: [...new Set(unknown)] }
}

const EXTERNAL_URL_PATTERN = /^https?:\/\//i

function isExternalUrl(value: string) {
  return EXTERNAL_URL_PATTERN.test(value.trim())
}

function isAssetApproved(asset: { kind: string; url: string }) {
  if (!asset.url.trim()) {
    return false
  }

  if (asset.kind === 'script') {
    return isApprovedRuntimeAssetUrl(asset.url, 'script')
  }

  if (asset.kind === 'link') {
    return isApprovedRuntimeAssetUrl(asset.url, 'stylesheet')
  }

  return !isExternalUrl(asset.url)
}

function countScripts(scripts: DeckManifestValidationInput['scripts']) {
  let inline = 0
  let external = 0

  for (const script of scripts) {
    if (script.inline) {
      inline += 1
    } else {
      external += 1
    }
  }

  return { inline, external }
}

function buildManifestWarnings(
  validation: DeckManifestValidationInput,
  parsed: DeckManifestParseInput,
  runtimeMode: DeckRuntimeMode,
  previewMode: 'css-only' | 'full-js',
  usesRevealAdapter: boolean,
): string[] {
  const warnings: string[] = []

  for (const issue of validation.issues) {
    if (issue.severity === 'warning') {
      warnings.push(issue.message)
    }
  }

  if (validation.scripts.length > 0 && !runtimeModeAllowsDeckScripts(runtimeMode)) {
    if (runtimeMode === 'reveal' && usesRevealAdapter) {
      warnings.push(
        'Reveal runtime scripts run in preview; deck-authored scripts are only kept when a Chart.js addon is declared.',
      )
    } else {
      warnings.push('Deck scripts are stripped in preview unless custom-JS mode is enabled.')
    }
  }

  if (runtimeMode === 'reveal' && !usesRevealAdapter) {
    warnings.push('Reveal structure detected without an approved runtime bundle.')
  }

  if (parsed.structure === 'unknown') {
    warnings.push('Slide structure could not be classified as plain or Reveal.')
  }

  if (previewMode === 'full-js' && runtimeMode !== 'custom-js') {
    warnings.push('Preview runs deck scripts in a sandboxed iframe.')
  }

  if (validation.externalUrls.length > 0) {
    warnings.push(
      `${validation.externalUrls.length} external URL${validation.externalUrls.length === 1 ? '' : 's'} blocked in preview.`,
    )
  }

  return [...new Set(warnings)]
}

export function composeDeckRuntimeManifest(input: {
  validation: DeckManifestValidationInput
  parsed: DeckManifestParseInput
  usesRevealAdapter: boolean
}): DeckRuntimeManifest {
  const { validation, parsed, usesRevealAdapter } = input
  const runtimeMode = validation.runtimeMode
  const previewMode = runtimeModeToBridgePreviewMode(runtimeMode, { usesRevealAdapter })
  const scriptCounts = countScripts(validation.scripts)
  const warningCount = validation.issues.filter((issue) => issue.severity === 'warning').length
  const errorCount = validation.issues.filter((issue) => issue.severity === 'error').length
  const approvedRuntime =
    validation.approvedRuntimeId && validation.approvedRuntimeVersion
      ? {
          id: validation.approvedRuntimeId,
          version: validation.approvedRuntimeVersion,
        }
      : undefined

  return {
    schemaVersion: DECK_RUNTIME_MANIFEST_SCHEMA_VERSION,
    runtimeMode,
    approvedRuntime,
    previewMode,
    fonts: summarizeManifestFonts(parsed.fonts),
    structure: parsed.structure,
    slideSelector: parsed.slideSelector,
    slideCount: parsed.slideCount,
    aspectRatio: DEFAULT_DECK_ASPECT_RATIO,
    scripts: {
      inline: scriptCounts.inline,
      external: scriptCounts.external,
      allowed: runtimeModeAllowsDeckScripts(runtimeMode) || usesRevealAdapter,
    },
    assets: parsed.assets.map((asset) => ({
      kind: asset.kind,
      url: asset.url,
      slideIndex: asset.slideIndex,
      approved: isAssetApproved(asset),
    })),
    network: {
      externalUrls: [...validation.externalUrls],
      connectAllowed: false,
    },
    validation: {
      valid: validation.valid,
      warnings: warningCount,
      errors: errorCount,
    },
    usesRevealAdapter,
    warnings: buildManifestWarnings(
      validation,
      parsed,
      runtimeMode,
      previewMode,
      usesRevealAdapter,
    ),
  }
}

export function buildDeckRuntimeManifestFromParts(
  validation: DeckManifestValidationInput,
  parsed: DeckManifestParseInput,
  usesRevealAdapter = false,
): DeckRuntimeManifest {
  const runtimeMode = validation.runtimeMode

  return composeDeckRuntimeManifest({
    validation: {
      ...validation,
      runtimeMode,
    },
    parsed,
    usesRevealAdapter,
  })
}

function isRuntimeMode(value: unknown): value is DeckRuntimeMode {
  return value === 'static' || value === 'reveal' || value === 'custom-js'
}

function isPreviewMode(value: unknown): value is DeckRuntimeManifest['previewMode'] {
  return value === 'css-only' || value === 'full-js'
}

function isManifestStructure(value: unknown): value is DeckManifestStructure {
  return value === 'plain' || value === 'reveal' || value === 'unknown'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isManifestScripts(value: unknown): value is DeckRuntimeManifestScripts {
  if (!value || typeof value !== 'object') {
    return false
  }

  const scripts = value as Partial<DeckRuntimeManifestScripts>

  return (
    isFiniteNumber(scripts.inline) &&
    isFiniteNumber(scripts.external) &&
    typeof scripts.allowed === 'boolean'
  )
}

function isManifestAsset(value: unknown): value is DeckRuntimeManifestAsset {
  if (!value || typeof value !== 'object') {
    return false
  }

  const asset = value as Partial<DeckRuntimeManifestAsset>

  return (
    typeof asset.kind === 'string' &&
    typeof asset.url === 'string' &&
    typeof asset.approved === 'boolean' &&
    (asset.slideIndex === undefined || isFiniteNumber(asset.slideIndex))
  )
}

function isManifestNetwork(value: unknown): value is DeckRuntimeManifestNetwork {
  if (!value || typeof value !== 'object') {
    return false
  }

  const network = value as Partial<DeckRuntimeManifestNetwork>

  return isStringArray(network.externalUrls) && network.connectAllowed === false
}

function isManifestValidation(value: unknown): value is DeckRuntimeManifestValidation {
  if (!value || typeof value !== 'object') {
    return false
  }

  const validation = value as Partial<DeckRuntimeManifestValidation>

  return (
    typeof validation.valid === 'boolean' &&
    isFiniteNumber(validation.warnings) &&
    isFiniteNumber(validation.errors)
  )
}

function isApprovedRuntime(value: unknown): value is DeckRuntimeManifestApprovedRuntime {
  if (!value || typeof value !== 'object') {
    return false
  }

  const approvedRuntime = value as Partial<DeckRuntimeManifestApprovedRuntime>

  return (
    typeof approvedRuntime.id === 'string' &&
    approvedRuntime.id.length > 0 &&
    typeof approvedRuntime.version === 'string' &&
    approvedRuntime.version.length > 0
  )
}

export function isDeckRuntimeManifest(value: unknown): value is DeckRuntimeManifest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const manifest = value as Partial<DeckRuntimeManifest>

  if (manifest.schemaVersion !== DECK_RUNTIME_MANIFEST_SCHEMA_VERSION) {
    return false
  }

  if (!isRuntimeMode(manifest.runtimeMode) || !isPreviewMode(manifest.previewMode)) {
    return false
  }

  if (!isFiniteNumber(manifest.slideCount) || manifest.slideCount < 0) {
    return false
  }

  if (!isManifestStructure(manifest.structure)) {
    return false
  }

  if (
    manifest.slideSelector !== null &&
    (manifest.slideSelector === undefined || typeof manifest.slideSelector !== 'string')
  ) {
    return false
  }

  if (typeof manifest.aspectRatio !== 'string' || manifest.aspectRatio.length === 0) {
    return false
  }

  if (manifest.approvedRuntime !== undefined && !isApprovedRuntime(manifest.approvedRuntime)) {
    return false
  }

  if (!isManifestScripts(manifest.scripts)) {
    return false
  }

  if (!Array.isArray(manifest.assets) || !manifest.assets.every(isManifestAsset)) {
    return false
  }

  if (!isManifestNetwork(manifest.network)) {
    return false
  }

  if (!isManifestValidation(manifest.validation)) {
    return false
  }

  if (typeof manifest.usesRevealAdapter !== 'boolean') {
    return false
  }

  if (!isStringArray(manifest.warnings)) {
    return false
  }

  return true
}

export function parseDeckRuntimeManifest(value: unknown): DeckRuntimeManifest | null {
  return isDeckRuntimeManifest(value) ? value : null
}

export function serializeDeckRuntimeManifest(manifest: DeckRuntimeManifest): string {
  return JSON.stringify(manifest)
}

export function deserializeDeckRuntimeManifest(raw: string): DeckRuntimeManifest | null {
  try {
    return parseDeckRuntimeManifest(JSON.parse(raw))
  } catch {
    return null
  }
}

export function resolvePreviewModeFromManifest(
  manifest: Pick<DeckRuntimeManifest, 'runtimeMode' | 'usesRevealAdapter' | 'previewMode'>,
): 'css-only' | 'full-js' {
  return (
    manifest.previewMode ??
    runtimeModeToBridgePreviewMode(manifest.runtimeMode, {
      usesRevealAdapter: manifest.usesRevealAdapter,
    })
  )
}

export function manifestIndicatesScriptStripping(
  manifest: Pick<DeckRuntimeManifest, 'previewMode' | 'scripts'>,
) {
  if (manifest.previewMode === 'full-js') {
    return false
  }

  const inline = manifest.scripts?.inline
  const external = manifest.scripts?.external

  if (!isFiniteNumber(inline) || !isFiniteNumber(external)) {
    return false
  }

  return inline + external > 0
}
