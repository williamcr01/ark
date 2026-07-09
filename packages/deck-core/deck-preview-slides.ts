import { injectRuntimeCsp, type DeckRuntimeMode } from '@ark/runtime-registry/deck-runtime.ts'
import { isApprovedRuntimeAssetUrl } from '@ark/runtime-registry/deck-runtime-registry.ts'
import {
  flattenRevealSlideElementsFromRoot,
  hasRevealSlideStructure,
} from './reveal-slide-index.ts'

export const SLIDE_SELECTOR_CHAIN = [
  'section.slide',
  'body > section',
  '.slides > section',
  '.reveal .slides > section',
  'main > section',
] as const

const INLINE_HANDLER_PATTERN = /^on[a-z]+$/i
const JAVASCRIPT_URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction'])

export type StripDeckScriptsForPreviewOptions = {
  preserveApprovedRuntimeScripts?: boolean
}

function serializeElementAttrs(element: Element) {
  return [...element.attributes]
    .filter((attribute) => !INLINE_HANDLER_PATTERN.test(attribute.name))
    .map((attribute) => `${attribute.name}="${attribute.value.replace(/"/g, '&quot;')}"`)
    .join(' ')
}

function isMetaRefresh(element: Element) {
  return (
    element.tagName.toLowerCase() === 'meta' &&
    element.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh'
  )
}

function isJavascriptUrl(value: string | null) {
  if (!value) {
    return false
  }

  // Decode common HTML entities / whitespace that can hide `javascript:` schemes.
  // Strip ASCII control chars and whitespace without a control-character regex
  // (eslint no-control-regex).
  const withoutControls = [...value]
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 0x20
    })
    .join('')
  const normalized = withoutControls
    .replace(/&#0*58;?/gi, ':')
    .replace(/&colon;/gi, ':')
    .trim()
    .toLowerCase()

  return normalized.startsWith('javascript:')
}

/**
 * Strip `<meta http-equiv="refresh">` and `javascript:` URL attributes.
 * Safe to call for every preview mode (including full-JS).
 */
export function stripHostileNavigationVectors(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)

  let node = walker.currentNode as Element | null
  const toRemove: Element[] = []

  while (node) {
    if (isMetaRefresh(node)) {
      toRemove.push(node)
    } else {
      for (const attribute of [...node.attributes]) {
        if (
          JAVASCRIPT_URL_ATTRS.has(attribute.name.toLowerCase()) &&
          isJavascriptUrl(attribute.value)
        ) {
          node.removeAttribute(attribute.name)
        }
      }
    }

    node = walker.nextNode() as Element | null
  }

  for (const element of toRemove) {
    element.remove()
  }
}

/**
 * Strip meta refresh / javascript: URLs from a full HTML document string.
 * Used for full-JS preview (which keeps deck scripts) and as a shared helper.
 */
export function stripHostileNavigationFromHtml(html: string): string {
  if (!html.trim()) {
    return html
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  if (doc.head) {
    stripHostileNavigationVectors(doc.head)
  }

  if (doc.body) {
    stripHostileNavigationVectors(doc.body)
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
    stripHostileNavigationVectors(doc.head)
  }

  if (doc.body) {
    stripScripts(doc.body, options)
    stripInlineHandlers(doc.body)
    stripHostileNavigationVectors(doc.body)
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
  if (hasRevealSlideStructure(root)) {
    const revealSlides = flattenRevealSlideElementsFromRoot(root)

    if (revealSlides.length > 0) {
      return revealSlides
    }
  }

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
