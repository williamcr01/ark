/** CSP applied to deck preview iframes — blocks all network access from deck runtime. */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "font-src data:",
  "form-action 'none'",
  "frame-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "object-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
].join('; ')

export const PREVIEW_CSP_META_TAG = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`

export function injectPreviewCsp(html: string) {
  if (!html.trim()) {
    return ''
  }

  if (html.includes('http-equiv="Content-Security-Policy"')) {
    return html
  }

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n${PREVIEW_CSP_META_TAG}`)
  }

  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1>\n<head>\n${PREVIEW_CSP_META_TAG}\n</head>`)
  }

  return `<head>\n${PREVIEW_CSP_META_TAG}\n</head>\n${html}`
}

export const EXTERNAL_URL_PATTERN = /^https?:\/\//i

export function isExternalUrl(value: string | null | undefined) {
  return Boolean(value?.trim() && EXTERNAL_URL_PATTERN.test(value.trim()))
}

const CSS_URL_PATTERN = /url\(\s*(['"]?)(https?:\/\/[^)'"]+)\1\s*\)/gi

export function collectUrlsFromCss(cssText: string | null | undefined) {
  const urls: string[] = []

  if (!cssText) {
    return urls
  }

  for (const match of cssText.matchAll(CSS_URL_PATTERN)) {
    if (match[2]) {
      urls.push(match[2])
    }
  }

  return urls
}

export function collectExternalUrls(doc: Document) {
  const urls = new Set<string>()

  for (const element of doc.querySelectorAll('[src], [href]')) {
    const src = element.getAttribute('src')
    const href = element.getAttribute('href')

    if (isExternalUrl(src)) {
      urls.add(src!.trim())
    }

    if (
      isExternalUrl(href) &&
      (element.tagName === 'LINK' ||
        element.tagName === 'A' ||
        element.tagName === 'SCRIPT' ||
        element.tagName === 'IMG' ||
        element.tagName === 'IFRAME')
    ) {
      urls.add(href!.trim())
    }
  }

  for (const style of doc.querySelectorAll('style')) {
    for (const url of collectUrlsFromCss(style.textContent)) {
      urls.add(url)
    }
  }

  for (const element of doc.querySelectorAll('[style]')) {
    for (const url of collectUrlsFromCss(element.getAttribute('style'))) {
      urls.add(url)
    }
  }

  return [...urls].sort()
}

export const DECK_ASSET_PROXY_PATH = '/api/deck-assets'

export function buildDeckAssetProxyUrl(originalUrl: string) {
  return `${DECK_ASSET_PROXY_PATH}?url=${encodeURIComponent(originalUrl)}`
}

export function parseDeckAssetAllowlist(raw: string | undefined) {
  if (!raw?.trim()) {
    return []
  }

  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

export function isAllowedAssetHost(url: URL, allowlist: readonly string[]) {
  if (allowlist.length === 0) {
    return false
  }

  const host = url.hostname.toLowerCase()

  return allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

export const NETWORK_REQUEST_ERROR_MESSAGE =
  'Decks cannot load external resources. Use self-contained inline CSS, data URIs, or SVG instead of http(s) URLs.'
