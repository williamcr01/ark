import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import {
  detectRuntimeMode,
  runtimeModeAllowsDeckScripts,
  usesRevealRuntimeAdapter,
} from '@ark/runtime-registry/deck-runtime.ts'
import { manifestIndicatesScriptStripping } from '@/lib/deck/deck-runtime-manifest'
import { isInertArkThemeScript } from '@ark/deck/document/theme.ts'
import { stripDeckScriptsForPreview } from '@/lib/deck/deck-slides'

const INLINE_HANDLER_PATTERN = /^on[a-z]+$/i

export type DeckDownloadVariant = 'original' | 'sanitized'

/** Formats the desktop export IPC accepts. */
export type DeckExportFormat = 'pdf' | 'pptx'

function parentHasInlineHandlers(root: ParentNode | null) {
  if (!root) {
    return false
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode() as Element | null

  while (node) {
    for (const attribute of [...node.attributes]) {
      if (INLINE_HANDLER_PATTERN.test(attribute.name)) {
        return true
      }
    }

    node = walker.nextNode() as Element | null
  }

  return false
}

export function deckDocumentHasExecutableContent(doc: Document) {
  const hasExecutableScript = [...doc.querySelectorAll('script')].some(
    (script) => !isInertArkThemeScript(script),
  )
  if (hasExecutableScript) {
    return true
  }

  return parentHasInlineHandlers(doc.documentElement)
}

export function deckHasExecutableContent(html: string) {
  if (!html.trim()) {
    return false
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  return deckDocumentHasExecutableContent(doc)
}

export {
  resolveDeckApprovedRuntime,
  getRuntimeRegistrySummary,
} from '@ark/runtime-registry/deck-runtime-registry.ts'

export function previewStripsDeckScripts(html: string, manifest?: DeckRuntimeManifest | null) {
  if (!html.trim()) {
    return false
  }

  if (manifest) {
    if (manifestIndicatesScriptStripping(manifest)) {
      return true
    }

    return manifest.previewMode === 'css-only' && deckHasExecutableContent(html)
  }

  if (usesRevealRuntimeAdapter(html)) {
    return false
  }

  const mode = detectRuntimeMode(html)

  return !runtimeModeAllowsDeckScripts(mode) && deckHasExecutableContent(html)
}

export function buildSanitizedDeckHtml(html: string) {
  return stripDeckScriptsForPreview(html)
}

export function resolveDownloadHtml(html: string, variant: DeckDownloadVariant) {
  return variant === 'sanitized' ? buildSanitizedDeckHtml(html) : html
}
