import {
  buildDeckRuntimeManifestFromParts,
  type DeckRuntimeManifest,
} from '../shared/deck-runtime-manifest.ts'
import { usesRevealRuntimeAdapter } from '../shared/deck-runtime.ts'
import { parseDeckHtml } from './deck-parser.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'
import type { DeckValidationReport } from '../src/lib/deck-validate.ts'

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

  return buildDeckRuntimeManifestFromParts(
    html,
    toManifestValidationInput(validation),
    {
      structure: parsed.structure,
      slideSelector: parsed.slideSelector,
      slideCount: parsed.slideCount,
      assets: parsed.assets.map((asset) => ({
        kind: asset.kind,
        url: asset.url,
        slideIndex: asset.slideIndex,
      })),
    },
    usesRevealRuntimeAdapter(html),
  )
}

export function buildDeckRuntimeManifestFromValidation(
  html: string,
  validation: DeckValidationReport,
): DeckRuntimeManifest {
  return buildDeckRuntimeManifestFromHtml(html, validation)
}

export function usesRevealAdapterForHtml(html: string) {
  return usesRevealRuntimeAdapter(html)
}
