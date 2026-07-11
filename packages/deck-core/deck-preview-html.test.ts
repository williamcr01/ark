// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { buildPreviewDocument, injectPreviewHandshake } from './deck-preview-html.ts'

function countMetaRefresh(doc: Document) {
  return [...doc.querySelectorAll('meta')].filter(
    (meta) => meta.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh',
  ).length
}

function hostileNulMetaRefreshDeck(options: { customJs?: boolean } = {}) {
  const rootAttrs = options.customJs ? ' lang="en" data-ark-deck="nav"' : ' lang="en"'

  return `<!DOCTYPE html>
<html${rootAttrs}>
<head>
  <meta charset="UTF-8" />
  <title>Hostile</title>
</head>
<body>
  <section class="slide">
    <met\x00a http-equiv="refresh" content="0;url=https://evil.example/" />
    <h1>Slide</h1>
  </section>
</body>
</html>`
}

describe('buildPreviewDocument', () => {
  it('injects the handshake and rewrites cached nonce placeholders after the preview boundary', () => {
    const noncePlaceholder = 'CachedNoncePlaceholder'
    const freshNonce = 'FreshSessionNonce'
    const { html } = buildPreviewDocument(hostileNulMetaRefreshDeck(), {
      parentOrigin: 'http://localhost:5173',
      nonce: noncePlaceholder,
    })

    expect(html).toContain(`'nonce-${noncePlaceholder}'`)
    expect(html).toContain(`nonce="${noncePlaceholder}"`)
    expect(html).not.toContain('data-ark-preview-handshake')
    expect(html).not.toContain('session-handshake-a')

    const previewHtml = injectPreviewHandshake(html, {
      parentOrigin: 'http://localhost:5173',
      handshake: 'session-handshake-a',
      nonce: freshNonce,
      noncePlaceholder,
    })
    const previewDoc = new DOMParser().parseFromString(previewHtml, 'text/html')
    const csp = previewDoc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content')

    expect(previewHtml).toContain('data-ark-preview-handshake')
    expect(previewHtml).toContain('session-handshake-a')
    expect(previewHtml).not.toContain(noncePlaceholder)
    expect(csp).toContain(`'nonce-${freshNonce}'`)
    expect(previewDoc.querySelector('[data-ark-preview-handshake]')?.getAttribute('nonce')).toBe(
      freshNonce,
    )
    expect(previewDoc.querySelector('[data-ark-preview-nav]')?.getAttribute('nonce')).toBe(
      freshNonce,
    )
  })

  it('strips NUL-byte meta refresh that only materializes after serialization', () => {
    const hostile = hostileNulMetaRefreshDeck()
    const firstParse = new DOMParser().parseFromString(hostile, 'text/html')

    expect(countMetaRefresh(firstParse)).toBe(0)

    const { html, runtimeMode } = buildPreviewDocument(hostile)
    const previewDoc = new DOMParser().parseFromString(html, 'text/html')

    expect(runtimeMode).toBe('static')
    expect(countMetaRefresh(previewDoc)).toBe(0)
    expect(html.toLowerCase()).not.toContain('http-equiv="refresh"')
    expect(html).toContain('data-ark-preview-nav')
  })

  it('strips NUL-byte meta refresh in custom-js preview mode', () => {
    const hostile = hostileNulMetaRefreshDeck({ customJs: true })
    const firstParse = new DOMParser().parseFromString(hostile, 'text/html')

    expect(countMetaRefresh(firstParse)).toBe(0)
    expect(firstParse.documentElement.getAttribute('data-ark-deck')).toBe('nav')

    const { html, runtimeMode } = buildPreviewDocument(hostile)
    const previewDoc = new DOMParser().parseFromString(html, 'text/html')

    expect(runtimeMode).toBe('custom-js')
    expect(countMetaRefresh(previewDoc)).toBe(0)
    expect(html.toLowerCase()).not.toContain('http-equiv="refresh"')
    expect(html).toContain('data-ark-preview-bridge')
    expect(previewDoc.documentElement.getAttribute('data-ark-deck')).toBe('nav')
  })
})
