// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import revealChartDeck from '@fixtures/reveal-chart-deck.html?raw'

import {
  deckUsesChartJsAddon,
  hasApprovedRevealRuntimeInDocument,
} from '@ark/runtime-registry/deck-runtime-registry.ts'
import { buildPreviewDocument, injectPreviewHandshake } from './preview-html.ts'

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
  it('absolutizes Ark image assets in attributes and CSS and permits only the app origin', () => {
    const deckId = '00000000-0000-4000-8000-000000000101'
    const assetId = '00000000-0000-4000-8000-000000000102'
    const path = `/api/decks/${deckId}/assets/${assetId}`
    const { html } = buildPreviewDocument(
      `<!DOCTYPE html><html><head><style>.hero{background-image:url("${path}")}</style></head><body><section class="slide"><img src="${path}" srcset="${path} 2x" alt="Hero"></section></body></html>`,
      { parentOrigin: 'http://localhost:5173' },
    )
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const csp = doc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content')

    expect(doc.querySelector('img')?.getAttribute('src')).toBe(`http://localhost:5173${path}`)
    expect(doc.querySelector('img')?.getAttribute('srcset')).toBe(`http://localhost:5173${path} 2x`)
    expect(doc.querySelector('style')?.textContent).toContain(`url("http://localhost:5173${path}")`)
    expect(csp).toContain('img-src data: blob: http://localhost:5173')
    expect(csp).toContain("connect-src 'none'")
  })

  it('pre-activates slide 0 for css-only decks before nav script runs', () => {
    const { html, runtimeMode } = buildPreviewDocument(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Plain</title></head>
<body>
  <section class="slide"><h1>One</h1></section>
  <section class="slide"><h1>Two</h1></section>
</body>
</html>`)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const slides = [...doc.querySelectorAll('section.slide')]

    expect(runtimeMode).toBe('static')
    expect(slides).toHaveLength(2)
    expect(slides[0]?.hasAttribute('data-ark-active')).toBe(true)
    expect(slides[0]?.classList.contains('active')).toBe(true)
    expect(slides[0]?.getAttribute('aria-hidden')).toBe('false')
    expect(slides[1]?.hasAttribute('data-ark-hidden')).toBe(true)
    expect(slides[1]?.getAttribute('aria-hidden')).toBe('true')
  })

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

  it('still injects the handshake when authored markup uses the handshake attribute name', () => {
    const noncePlaceholder = 'CachedNoncePlaceholder'
    const authored = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Plain</title></head>
<body>
  <section class="slide" data-ark-preview-handshake="authored"><h1>One</h1></section>
</body>
</html>`
    const { html } = buildPreviewDocument(authored, {
      parentOrigin: 'http://localhost:5173',
      nonce: noncePlaceholder,
    })

    const previewHtml = injectPreviewHandshake(html, {
      parentOrigin: 'http://localhost:5173',
      handshake: 'session-handshake-authored',
      nonce: 'FreshSessionNonce',
      noncePlaceholder,
    })

    expect(previewHtml).toContain('session-handshake-authored')
    expect(previewHtml).toMatch(/<script\b[^>]*\bdata-ark-preview-handshake\b/i)
  })

  it('keeps post-serialize hostile stripping on the handshake injection path', () => {
    const noncePlaceholder = 'CachedNoncePlaceholder'
    const { html } = buildPreviewDocument(hostileNulMetaRefreshDeck(), {
      parentOrigin: 'http://localhost:5173',
      nonce: noncePlaceholder,
    })

    const previewHtml = injectPreviewHandshake(html, {
      parentOrigin: 'http://localhost:5173',
      handshake: 'session-handshake-b',
      nonce: 'FreshSessionNonce',
      noncePlaceholder,
    })
    const previewDoc = new DOMParser().parseFromString(previewHtml, 'text/html')

    expect(countMetaRefresh(previewDoc)).toBe(0)
    expect(previewHtml.toLowerCase()).not.toContain('http-equiv="refresh"')
    expect(previewHtml).toContain('data-ark-preview-handshake')
    expect(previewHtml).toContain('session-handshake-b')
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

  it('preserves chart init scripts and allows chart.js CSP for reveal addon decks', () => {
    const { html, runtimeMode, nonce } = buildPreviewDocument(revealChartDeck, {
      parentOrigin: 'http://localhost:5173',
    })
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const csp = doc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content')

    expect(runtimeMode).toBe('reveal')
    expect(nonce).toBeNull()
    expect(html).toContain('data-ark-preview-reveal')
    expect(html).toContain('new Chart(')
    expect(html).toContain('/api/runtimes/chart.js/4.5.1/chart.umd.min.js')
    expect(html).toContain('document.dispatchEvent(new CustomEvent(C.CHANGE')
    expect(csp).toContain("'unsafe-inline'")
    expect(csp).toContain('chart.js/4.5.1/chart.umd.min.js')
  })

  it('strips deck scripts when Chart.js addon markers are incomplete', () => {
    const incomplete = `<!DOCTYPE html>
<html
  lang="en"
  data-ark-runtime="reveal"
  data-ark-runtime-lib="reveal.js"
  data-ark-runtime-version="5.1.0"
  data-ark-runtime-addon-lib="chart.js"
>
  <head>
    <link rel="stylesheet" href="/api/runtimes/reveal.js/5.1.0/reveal.css" />
    <link rel="stylesheet" href="/api/runtimes/reveal.js/5.1.0/theme/white.css" />
  </head>
  <body>
    <div class="reveal"><div class="slides"><section><h1>One</h1></section></div></div>
    <script src="/api/runtimes/reveal.js/5.1.0/reveal.js"></script>
    <script src="/api/runtimes/chart.js/4.5.1/chart.umd.min.js"></script>
    <script>new Chart(document.getElementById('c'), {})</script>
  </body>
</html>`
    const incompleteDoc = new DOMParser().parseFromString(incomplete, 'text/html')
    const { html, nonce } = buildPreviewDocument(incomplete, {
      parentOrigin: 'http://localhost:5173',
    })

    expect(deckUsesChartJsAddon(incompleteDoc)).toBe(false)
    expect(nonce).not.toBeNull()
    expect(html).toContain('/api/runtimes/reveal.js/5.1.0/reveal.js')
    expect(html).toContain('/api/runtimes/chart.js/4.5.1/chart.umd.min.js')
    expect(html).not.toContain('new Chart(')
  })

  it('detects approved Reveal scripts only when the asset kind is script', () => {
    const bogus = new DOMParser().parseFromString(
      `<!DOCTYPE html>
<html lang="en">
<body>
  <div class="reveal"><div class="slides"><section>One</section></div></div>
  <script src="/api/runtimes/reveal.js/5.1.0/reveal.css"></script>
</body>
</html>`,
      'text/html',
    )
    const valid = new DOMParser().parseFromString(
      `<!DOCTYPE html>
<html lang="en">
<body>
  <div class="reveal"><div class="slides"><section>One</section></div></div>
  <script src="/api/runtimes/reveal.js/5.1.0/reveal.js"></script>
</body>
</html>`,
      'text/html',
    )
    const completeAddon = new DOMParser().parseFromString(revealChartDeck, 'text/html')

    expect(hasApprovedRevealRuntimeInDocument(bogus)).toBe(false)
    expect(hasApprovedRevealRuntimeInDocument(valid)).toBe(true)
    expect(deckUsesChartJsAddon(completeAddon)).toBe(true)
  })
})
