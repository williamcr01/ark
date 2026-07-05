import { injectRuntimeCsp, type DeckRuntimeMode } from './deck-runtime.ts'
import { isApprovedRuntimeAssetUrl } from './deck-runtime-registry.ts'

export const SLIDE_SELECTOR_CHAIN = [
  'section.slide',
  'body > section',
  '.slides > section',
  '.reveal .slides > section',
  'main > section',
] as const

const INLINE_HANDLER_PATTERN = /^on[a-z]+$/i

export type StripDeckScriptsForPreviewOptions = {
  preserveApprovedRuntimeScripts?: boolean
}

function serializeElementAttrs(element: Element) {
  return [...element.attributes]
    .filter((attribute) => !INLINE_HANDLER_PATTERN.test(attribute.name))
    .map((attribute) => `${attribute.name}="${attribute.value.replace(/"/g, '&quot;')}"`)
    .join(' ')
}

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

export function findSlideElements(root: ParentNode) {
  for (const selector of SLIDE_SELECTOR_CHAIN) {
    const slides = [...root.querySelectorAll(selector)]

    if (slides.length > 0) {
      return slides
    }
  }

  return []
}

export function injectRuntimeCspForMode(html: string, mode: DeckRuntimeMode) {
  return injectRuntimeCsp(html, mode)
}
