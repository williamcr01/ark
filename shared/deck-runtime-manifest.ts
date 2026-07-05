import { isApprovedRuntimeAssetUrl } from './deck-runtime-registry.ts'
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
      warnings.push('Reveal runtime scripts run in preview; unapproved scripts are stripped.')
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

export function isDeckRuntimeManifest(value: unknown): value is DeckRuntimeManifest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const manifest = value as Partial<DeckRuntimeManifest>

  return (
    manifest.schemaVersion === DECK_RUNTIME_MANIFEST_SCHEMA_VERSION &&
    (manifest.runtimeMode === 'static' ||
      manifest.runtimeMode === 'reveal' ||
      manifest.runtimeMode === 'custom-js') &&
    (manifest.previewMode === 'css-only' || manifest.previewMode === 'full-js') &&
    typeof manifest.slideCount === 'number'
  )
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

  return manifest.scripts.inline + manifest.scripts.external > 0
}
