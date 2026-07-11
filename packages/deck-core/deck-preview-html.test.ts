// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { buildPreviewDocument } from './deck-preview-html.ts'

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
