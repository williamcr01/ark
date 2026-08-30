import { injectRuntimeCsp, type DeckRuntimeMode } from '@ark/runtime-registry/deck-runtime.ts'
import { isApprovedRuntimeAssetUrl } from '@ark/runtime-registry/deck-runtime-registry.ts'
import { findSlideElements, SLIDE_SELECTOR_CHAIN } from '@ark/deck/document/slides.ts'
import {
  INLINE_HANDLER_PATTERN,
  serializeAttribute,
  isJavascriptUrl,
  stripHostileNavigationFromHtml,
  stripHostileNavigationVectors,
} from '@ark/deck/document/sanitize.ts'

export { findSlideElements, SLIDE_SELECTOR_CHAIN }
export { isJavascriptUrl, stripHostileNavigationFromHtml, stripHostileNavigationVectors }

export type StripDeckScriptsForPreviewOptions = {
  preserveApprovedRuntimeScripts?: boolean
}

/** Serialize attrs for static/reveal preview — drops inline `on*` handlers. */
function serializeElementAttrs(element: Element) {
  return [...element.attributes]
    .filter((attribute) => !INLINE_HANDLER_PATTERN.test(attribute.name))
    .map(serializeAttribute)
    .join(' ')
}

/**
 * Strip meta refresh / javascript: URLs from a full HTML document string.
 * Used for full-JS preview (which keeps deck scripts) and as a shared helper.
 * Preserves root `<html>` / `<body>` attributes including legitimate `on*` handlers.
 */

function stripInlineHandlers(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)

  let node = walker.currentNode as Element | null

  while (node) {
    for (const attribute of [...node.attributes]) {
      if (INLINE_HANDLER_PATTERN.test(attribute.name)) {
        node.removeAttribute(attribute.name)
      }
    }

    node = walker.nextNode() as Element | null
  }
}

function shouldPreserveScript(
  script: HTMLScriptElement,
  options: StripDeckScriptsForPreviewOptions,
) {
  return (
    options.preserveApprovedRuntimeScripts &&
    isApprovedRuntimeAssetUrl(script.getAttribute('src'), 'script')
  )
}

function stripScripts(root: ParentNode, options: StripDeckScriptsForPreviewOptions = {}) {
  root.querySelectorAll('script').forEach((script) => {
    if (shouldPreserveScript(script, options)) {
      return
    }

    script.remove()
  })
}

export function stripDeckScriptsForPreview(
  html: string,
  options: StripDeckScriptsForPreviewOptions = {},
): string {
  if (!html.trim()) {
    return ''
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  if (doc.documentElement) {
    stripHostileNavigationVectors(doc.documentElement)
  }

  if (doc.head) {
    stripScripts(doc.head, options)
    stripInlineHandlers(doc.head)
  }

  if (doc.body) {
    stripScripts(doc.body, options)
    stripInlineHandlers(doc.body)
  }

  const htmlAttrs = doc.documentElement ? serializeElementAttrs(doc.documentElement) : ''
  const bodyAttrs = doc.body ? serializeElementAttrs(doc.body) : ''
  const headHtml = doc.head?.innerHTML ?? ''
  const bodyHtml = doc.body?.innerHTML ?? ''
  const htmlOpen = htmlAttrs ? `<html ${htmlAttrs}>` : '<html>'
  const bodyOpen = bodyAttrs ? `<body ${bodyAttrs}>` : '<body>'

  return `<!DOCTYPE html>
${htmlOpen}
<head>
${headHtml}
</head>
${bodyOpen}
${bodyHtml}
</body>
</html>`
}

export function injectRuntimeCspForMode(html: string, mode: DeckRuntimeMode) {
  return injectRuntimeCsp(html, mode)
}
