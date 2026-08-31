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
} from '@ark/runtime-registry/deck-runtime-manifest.ts'

import {
  buildDeckRuntimeManifestFromParts,
  type DeckManifestStructure,
  type DeckRuntimeManifest,
} from '@ark/runtime-registry/deck-runtime-manifest.ts'
import { hasApprovedRevealRuntimeInDocument } from '@ark/runtime-registry/deck-runtime-registry.ts'
import {
  DECK_FONT_MARKER_ATTRS,
  DECK_FONT_ROLES,
  type DeckFontSelection,
} from '@ark/runtime-registry/deck-font-registry.ts'
import { findSlideElements, SLIDE_SELECTOR_CHAIN } from '@ark/deck-preview/preview-slides.ts'
import { hasRevealSlideStructure } from '@ark/deck/document/reveal-slide-index.ts'
import {
  validateDeckDocumentInBrowser,
  validateDeckHtmlInBrowser,
  type DeckValidationReport,
} from './deck-validate.ts'

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

/** Reads the deck's `data-ark-font-*` markers straight off a parsed document. */
function readDeckFontSelection(doc: Document): DeckFontSelection {
  return Object.fromEntries(
    DECK_FONT_ROLES.map((role) => {
      const attribute = DECK_FONT_MARKER_ATTRS[role]
      const value =
        doc.documentElement?.getAttribute(attribute) ?? doc.body?.getAttribute(attribute) ?? null
      return [role, value?.trim().toLowerCase() || null]
    }),
  ) as DeckFontSelection
}

export function buildDeckRuntimeManifestFromBrowserDocument(
  doc: Document,
  validation: DeckValidationReport,
): DeckRuntimeManifest {
  const runtimeMode = validation.runtimeMarkers.runtimeMode

  return buildDeckRuntimeManifestFromParts(
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
      fonts: readDeckFontSelection(doc),
    },
    runtimeMode === 'reveal' && hasApprovedRevealRuntimeInDocument(doc),
  )
}

export function buildDeckRuntimeManifestInBrowser(html: string): DeckRuntimeManifest {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const validation = html.trim()
    ? validateDeckDocumentInBrowser(doc, html)
    : validateDeckHtmlInBrowser(html)

  return buildDeckRuntimeManifestFromBrowserDocument(doc, validation)
}
