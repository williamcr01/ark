import { detectRuntimeMode, runtimeModeAllowsDeckScripts } from '@/lib/deck-runtime'
import { stripDeckScriptsForPreview } from '@/lib/deck-slides'

const INLINE_HANDLER_PATTERN = /^on[a-z]+$/i

export type DeckDownloadVariant = 'original' | 'sanitized'

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

export function deckHasExecutableContent(html: string) {
  if (!html.trim()) {
    return false
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  if (doc.querySelector('script')) {
    return true
  }

  return parentHasInlineHandlers(doc.documentElement)
}

export {
  resolveDeckApprovedRuntime,
  getRuntimeRegistrySummary,
} from '../../shared/deck-runtime-registry.ts'

export function previewStripsDeckScripts(html: string) {
  if (!html.trim()) {
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
