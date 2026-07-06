import { isApprovedRuntimeAssetUrl } from '../shared/deck-runtime-registry.ts'
import {
  buildDeckRuntimeManifestFromParts,
  type DeckRuntimeManifest,
} from '../shared/deck-runtime-manifest.ts'
import { parseDeckHtml } from './deck-parser.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'
import type { DeckValidationReport } from '../shared/deck-validate.ts'

function resolveUsesRevealAdapter(
  validation: DeckValidationReport,
  assets: Array<{ kind: string; url: string }>,
) {
  if (validation.runtimeMarkers.runtimeMode !== 'reveal') {
    return false
  }

  return assets.some(
    (asset) => asset.kind === 'script' && isApprovedRuntimeAssetUrl(asset.url, 'script'),
  )
}

function toManifestValidationInput(validation: DeckValidationReport) {
  return {
    valid: validation.valid,
    slideCount: validation.slideCount,
    scripts: validation.scripts,
    externalUrls: validation.externalUrls,
    runtimeMode: validation.runtimeMarkers.runtimeMode,
    approvedRuntimeId: validation.runtimeMarkers.approvedRuntimeId,
    approvedRuntimeVersion: validation.runtimeMarkers.approvedRuntimeVersion,
    issues: validation.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      severity: issue.severity,
    })),
  }
}

export function buildDeckRuntimeManifestFromHtml(
  html: string,
  validation: DeckValidationReport = validateDeckHtmlOnServer(html),
): DeckRuntimeManifest {
  const parsed = parseDeckHtml(html)
  const assets = parsed.assets.map((asset) => ({
    kind: asset.kind,
    url: asset.url,
    slideIndex: asset.slideIndex,
  }))

  return buildDeckRuntimeManifestFromParts(
    toManifestValidationInput(validation),
    {
      structure: parsed.structure,
      slideSelector: parsed.slideSelector,
      slideCount: parsed.slideCount,
      assets,
    },
    resolveUsesRevealAdapter(validation, assets),
  )
}

export function buildDeckRuntimeManifestFromValidation(
  html: string,
  validation: DeckValidationReport,
): DeckRuntimeManifest {
  return buildDeckRuntimeManifestFromHtml(html, validation)
}
