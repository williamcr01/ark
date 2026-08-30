export function normalizeDeckTitle(title: unknown) {
  return typeof title === 'string' && title.trim() ? title.trim() : 'Untitled deck'
}

/** Extract a display title from deck HTML (`<title>`), matching server persistence. */
export function extractDeckTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  return normalizeDeckTitle(match?.[1])
}
