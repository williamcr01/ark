export {
  composeDeckRuntimeManifest,
  buildDeckRuntimeManifestFromParts,
  DEFAULT_DECK_ASPECT_RATIO,
  DECK_RUNTIME_MANIFEST_SCHEMA_VERSION,
  deserializeDeckRuntimeManifest,
  isDeckRuntimeManifest,
  manifestIndicatesScriptStripping,
  parseDeckRuntimeManifest,
  resolvePreviewModeFromManifest,
  serializeDeckRuntimeManifest,
  type DeckManifestParseInput,
  type DeckManifestStructure,
  type DeckManifestValidationInput,
  type DeckManifestValidationIssue,
  type DeckRuntimeManifest,
  type DeckRuntimeManifestApprovedRuntime,
  type DeckRuntimeManifestAsset,
  type DeckRuntimeManifestNetwork,
  type DeckRuntimeManifestScripts,
  type DeckRuntimeManifestValidation,
} from '../../shared/deck-runtime-manifest.ts'

import {
  buildDeckRuntimeManifestFromParts,
  type DeckManifestStructure,
  type DeckRuntimeManifest,
} from '../../shared/deck-runtime-manifest.ts'
import { usesRevealRuntimeAdapter } from '../../shared/deck-runtime.ts'
import { findSlideElements, SLIDE_SELECTOR_CHAIN } from '../../shared/deck-preview-slides.ts'
import { hasRevealSlideStructure } from '../../shared/reveal-slide-index.ts'
import { validateDeckHtmlInBrowser } from '@/lib/deck-validate'

function detectSlideSelector(doc: Document) {
  if (hasRevealSlideStructure(doc)) {
    return '.reveal .slides > section'
  }

  for (const selector of SLIDE_SELECTOR_CHAIN) {
    if (doc.querySelectorAll(selector).length > 0) {
      return selector
    }
  }

  return null
}

function detectStructure(
  doc: Document,
  runtimeMode: DeckRuntimeManifest['runtimeMode'],
): DeckManifestStructure {
  if (runtimeMode === 'reveal' || hasRevealSlideStructure(doc)) {
    return 'reveal'
  }

  if (findSlideElements(doc).length > 0) {
    return 'plain'
  }

  return 'unknown'
}

export function buildDeckRuntimeManifestInBrowser(html: string): DeckRuntimeManifest {
  const validation = validateDeckHtmlInBrowser(html)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const runtimeMode = validation.runtimeMarkers.runtimeMode

  return buildDeckRuntimeManifestFromParts(
    html,
    {
      valid: validation.valid,
      slideCount: validation.slideCount,
      scripts: validation.scripts,
      externalUrls: validation.externalUrls,
      runtimeMode,
      approvedRuntimeId: validation.runtimeMarkers.approvedRuntimeId,
      approvedRuntimeVersion: validation.runtimeMarkers.approvedRuntimeVersion,
      issues: validation.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        severity: issue.severity,
      })),
    },
    {
      structure: detectStructure(doc, runtimeMode),
      slideSelector: detectSlideSelector(doc),
      slideCount: validation.slideCount,
      assets: [],
    },
    usesRevealRuntimeAdapter(html),
  )
}
