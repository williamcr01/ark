export function normalizeDeckTitle(title: unknown) {
  return typeof title === 'string' && title.trim() ? title.trim() : 'Untitled deck'
}

/** Extract a display title from deck HTML (`<title>`), matching server persistence. */
export function extractDeckTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  return normalizeDeckTitle(match?.[1])
}

const escapeHtmlText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Rewrite the document `<title>` to match a deck title, preserving any
 * attributes on the opening tag. Only the head region is considered, so an
 * `<svg><title>` accessible label is never mistaken for the document title.
 * When the head has no `<title>`, one is inserted after the opening head tag.
 * Returns the original html unchanged when neither is possible.
 */
export function syncDeckHtmlTitle(html: string, title: string) {
  const escaped = escapeHtmlText(title)
  const headEnd = html.search(/<\/head\s*>/i)
  const head = headEnd === -1 ? '' : html.slice(0, headEnd)
  const rest = headEnd === -1 ? html : html.slice(headEnd)
  const replaced = head.replace(/<title[^>]*>[\s\S]*?<\/title>/i, (match) => {
    const openTagEnd = match.indexOf('>') + 1
    return `${match.slice(0, openTagEnd)}${escaped}</title>`
  })
  if (replaced !== head) return `${replaced}${rest}`
  return html.replace(/(<head[^>]*>)/i, (match) => `${match}<title>${escaped}</title>`)
}
