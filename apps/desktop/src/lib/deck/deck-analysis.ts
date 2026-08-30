import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import type { DeckRuntimeMode } from '@/lib/deck/deck-runtime'
import { documentAllowsDeckInitScripts } from '@/lib/deck/deck-runtime'
import {
  buildDeckRuntimeManifestFromBrowserDocument,
  manifestIndicatesScriptStripping,
} from '@/lib/deck/deck-runtime-manifest'
import { deckDocumentHasExecutableContent } from '@/lib/deck/deck-export'
import {
  parseDeckSlideDocument,
  type ParsedDeck,
  type ParseDeckSlidesOptions,
} from '@/lib/deck/deck-slides'
import {
  validateDeckDocumentInBrowser,
  validateDeckHtmlInBrowser,
  type DeckValidationReport,
} from '@/lib/deck/deck-validate'

export type DeckBrowserAnalysis = ParsedDeck & {
  validation: DeckValidationReport
  runtimeManifest: DeckRuntimeManifest
  runtimeMode: DeckRuntimeMode
  hasExecutableContent: boolean
  allowsDeckInitScripts: boolean
  usesStaticPreview: boolean
}

function previewUsesStaticRendering(manifest: DeckRuntimeManifest, hasExecutableContent: boolean) {
  if (manifestIndicatesScriptStripping(manifest)) {
    return true
  }

  return manifest.previewMode === 'css-only' && hasExecutableContent
}

export function analyzeDeckInBrowser(
  html: string,
  options: ParseDeckSlidesOptions = {},
): DeckBrowserAnalysis {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const parsedDeck = parseDeckSlideDocument(doc, options)
  const validation = html.trim()
    ? validateDeckDocumentInBrowser(doc, html)
    : validateDeckHtmlInBrowser(html)
  const runtimeManifest = buildDeckRuntimeManifestFromBrowserDocument(doc, validation)
  const hasExecutableContent = html.trim() ? deckDocumentHasExecutableContent(doc) : false

  return {
    ...parsedDeck,
    validation,
    runtimeManifest,
    runtimeMode: runtimeManifest.runtimeMode,
    hasExecutableContent,
    allowsDeckInitScripts: documentAllowsDeckInitScripts(doc),
    usesStaticPreview: previewUsesStaticRendering(runtimeManifest, hasExecutableContent),
  }
}
