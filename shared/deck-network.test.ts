import { describe, expect, it } from 'vitest'

import {
  buildDeckAssetProxyUrl,
  collectExternalUrls,
  collectUrlsFromCss,
  injectPreviewCsp,
  isAllowedAssetHost,
  isExternalUrl,
  parseDeckAssetAllowlist,
  PREVIEW_CSP,
  PREVIEW_CSP_META_TAG,
} from './deck-network'

describe('deck-network', () => {
  it('detects external URLs', () => {
    expect(isExternalUrl('https://example.com/a.png')).toBe(true)
    expect(isExternalUrl('/local.png')).toBe(false)
    expect(isExternalUrl('data:image/png;base64,abc')).toBe(false)
  })

  it('collects external URLs from deck markup', () => {
    const doc = new DOMParser().parseFromString(`<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />
</head>
<body>
  <section class="slide">
    <img src="https://example.com/logo.png" alt="Logo" />
  </section>
</body>
</html>`, 'text/html')

    expect(collectExternalUrls(doc)).toEqual([
      'https://example.com/logo.png',
      'https://fonts.googleapis.com/css2?family=Inter',
    ])
  })

  it('collects external URLs from CSS url() in style blocks and inline styles', () => {
    const doc = new DOMParser().parseFromString(`<!DOCTYPE html>
<html>
<head>
  <style>
    .slide { background-image: url("https://example.com/hero.png"); }
    @import url(https://fonts.googleapis.com/css2?family=Inter);
  </style>
</head>
<body>
  <section class="slide" style="background: url('https://example.com/bg.jpg')">Hi</section>
</body>
</html>`, 'text/html')

    expect(collectExternalUrls(doc)).toEqual([
      'https://example.com/bg.jpg',
      'https://example.com/hero.png',
      'https://fonts.googleapis.com/css2?family=Inter',
    ])
  })

  it('extracts external URLs from raw CSS text', () => {
    expect(collectUrlsFromCss(`
      .hero { background-image: url(https://example.com/hero.png); }
      .logo { list-style-image: url("https://example.com/icon.svg"); }
    `)).toEqual([
      'https://example.com/hero.png',
      'https://example.com/icon.svg',
    ])
  })

  it('builds deck asset proxy URLs', () => {
    expect(buildDeckAssetProxyUrl('https://example.com/a.png')).toBe(
      '/api/deck-assets?url=https%3A%2F%2Fexample.com%2Fa.png',
    )
  })

  it('parses asset allowlists and matches hosts', () => {
    const allowlist = parseDeckAssetAllowlist('cdn.example.com, fonts.gstatic.com')

    expect(allowlist).toEqual(['cdn.example.com', 'fonts.gstatic.com'])
    expect(isAllowedAssetHost(new URL('https://cdn.example.com/a.woff2'), allowlist)).toBe(true)
    expect(isAllowedAssetHost(new URL('https://evil.example.com/a.woff2'), allowlist)).toBe(false)
    expect(isAllowedAssetHost(new URL('https://fonts.gstatic.com/a.woff2'), allowlist)).toBe(true)
  })

  it('blocks all hosts when the allowlist is empty', () => {
    expect(isAllowedAssetHost(new URL('https://example.com/a.png'), [])).toBe(false)
  })

  it('includes connect-src none in preview CSP', () => {
    expect(PREVIEW_CSP).toContain("connect-src 'none'")
    expect(PREVIEW_CSP).toContain("default-src 'none'")
  })

  it('injects a CSP meta tag into preview HTML', () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Deck</title></head>
<body><section class="slide">Hi</section></body>
</html>`

    const result = injectPreviewCsp(html)

    expect(result).toContain(PREVIEW_CSP_META_TAG)
    expect(result).toContain("connect-src 'none'")
  })
})
