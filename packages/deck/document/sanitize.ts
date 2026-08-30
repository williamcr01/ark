/**
 * Strips markup that can navigate or execute on its own: inline event handlers and
 * `javascript:` URLs. Applied when patching a document as well as when rendering a
 * preview, so it belongs to the document model rather than the preview layer.
 */

export const INLINE_HANDLER_PATTERN = /^on[a-z]+$/i
const JAVASCRIPT_URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction'])
export function serializeAttribute(attribute: Attr) {
  return `${attribute.name}="${attribute.value.replace(/"/g, '&quot;')}"`
}

/**
 * Serialize attrs for navigation-only sanitization — preserves `on*` handlers.
 * Custom-JS decks may legitimately use root handlers like `<body onload="boot()">`.
 */
function serializeRootElementAttrs(element: Element) {
  return [...element.attributes].map(serializeAttribute).join(' ')
}

/**
 * Treat any element with `http-equiv="refresh"` as hostile.
 * Tag-name checks alone miss parse-unstable markup (e.g. `met\x00a`) that keeps
 * the attribute but is not a real `<meta>` until a later serialize/reparse.
 */
function isMetaRefresh(element: Element) {
  return element.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh'
}

export function isJavascriptUrl(value: string | null) {
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

export function stripHostileNavigationFromHtml(html: string): string {
  if (!html.trim()) {
    return html
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  if (doc.documentElement) {
    stripHostileNavigationVectors(doc.documentElement)
  }

  const htmlAttrs = doc.documentElement ? serializeRootElementAttrs(doc.documentElement) : ''
  const bodyAttrs = doc.body ? serializeRootElementAttrs(doc.body) : ''
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
