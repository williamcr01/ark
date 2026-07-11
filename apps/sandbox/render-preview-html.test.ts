import { describe, expect, it } from 'vitest'

import { renderCachedPreviewDocument, renderPreviewHtml } from './render-preview-html.ts'
import {
  createPreviewHtmlCache,
  PREVIEW_HTML_CACHE_NONCE_PLACEHOLDER,
} from './preview-html-cache.ts'

const plainCssDeck = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Demo</title></head>
<body>
  <section class="slide"><h1>One</h1></section>
  <section class="slide"><h1>Two</h1></section>
</body>
</html>`

const fullJsDeck = `<!DOCTYPE html>
<html lang="en" data-ark-deck="nav">
<head><meta charset="UTF-8" /><title>Full JS</title></head>
<body>
  <section class="slide active"><h1>One</h1></section>
  <section class="slide"><h1>Two</h1></section>
  <script>
    document.addEventListener('ark:deck-goto', (event) => {
      const index = event.detail.index;
      document.querySelectorAll('section.slide').forEach((slide, i) => {
        slide.classList.toggle('active', i === index);
      });
      document.dispatchEvent(new CustomEvent('ark:deck-slide-change', { detail: { index } }));
    });
  </script>
</body>
</html>`

const hostileScriptsDeck = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Hostile</title></head>
<body>
  <section class="slide"><h1>One</h1></section>
  <script>window.top.location = 'https://evil.test'</script>
</body>
</html>`

const hostileNavigationDeck = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="refresh" content="0;url=https://evil.test/" />
  <title>Hostile Navigation</title>
</head>
<body>
  <section class="slide">
    <a href="javascript:alert('xss')">Bad link</a>
    <h1 onclick="window.top.location = 'https://evil.test'">One</h1>
  </section>
  <script>window.top.location = 'https://evil.test'</script>
</body>
</html>`

const revealRegistryDeck = `<!DOCTYPE html>
<html lang="en" data-ark-runtime="reveal" data-ark-runtime-lib="reveal.js" data-ark-runtime-version="5.1.0">
<head>
  <meta charset="UTF-8" />
  <title>Reveal Registry Deck</title>
  <link rel="stylesheet" href="/api/runtimes/reveal.js/5.1.0/reveal.css" />
  <link rel="stylesheet" href="/api/runtimes/reveal.js/5.1.0/theme/white.css" />
</head>
<body>
  <div class="reveal">
    <div class="slides">
      <section><h1>Reveal with approved runtime assets</h1></section>
    </div>
  </div>
  <script src="/api/runtimes/reveal.js/5.1.0/reveal.js"></script>
</body>
</html>`

describe('renderPreviewHtml', () => {
  it('renders css-only and full-js preview HTML on the server', () => {
    const cssOnly = renderPreviewHtml(plainCssDeck, {
      parentOrigin: 'http://localhost:5173',
    })
    const fullJs = renderPreviewHtml(fullJsDeck, {
      parentOrigin: 'http://localhost:5173',
    })

    expect(cssOnly).toContain('data-ark-preview-nav')
    expect(cssOnly).toContain('PARENT_ORIGIN')
    expect(cssOnly).toContain('http://localhost:5173')
    expect(fullJs).toContain('data-ark-preview-bridge')
    expect(fullJs).toContain('PARENT_ORIGIN')
    expect(fullJs).toContain('http://localhost:5173')
  })

  it('strips hostile scripts for static preview decks', () => {
    const previewHtml = renderPreviewHtml(hostileScriptsDeck)

    expect(previewHtml).not.toContain('window.top.location')
    expect(previewHtml).toContain('data-ark-preview-nav')
  })

  it('preserves approved runtime scripts with app-origin asset URLs', () => {
    const previewHtml = renderPreviewHtml(revealRegistryDeck, {
      parentOrigin: 'http://localhost:5173',
    })

    expect(previewHtml).toContain(
      'src="http://localhost:5173/api/runtimes/reveal.js/5.1.0/reveal.js"',
    )
    expect(previewHtml).toContain(
      'href="http://localhost:5173/api/runtimes/reveal.js/5.1.0/reveal.css"',
    )
    expect(previewHtml).toContain('http://localhost:5173/api/runtimes/reveal.js/5.1.0/reveal.js')
    expect(previewHtml).toContain('data-ark-preview-reveal')
  })

  it('caches the sanitized pre-handshake base and injects per-session handshakes afterward', () => {
    const cache = createPreviewHtmlCache()
    const first = renderCachedPreviewDocument(
      plainCssDeck,
      {
        parentOrigin: 'http://localhost:5173',
        handshake: 'handshake-one',
      },
      cache,
    )
    const cachedBase = first.cacheKey ? cache.get(first.cacheKey) : null
    const second = renderCachedPreviewDocument(
      plainCssDeck,
      {
        parentOrigin: 'http://localhost:5173',
        handshake: 'handshake-two',
      },
      cache,
    )

    expect(first.cacheStatus).toBe('miss')
    expect(second.cacheStatus).toBe('hit')
    expect(first.runtimeMode).toBe('static')
    expect(second.runtimeMode).toBe('static')
    expect(first.nonce).toBeTruthy()
    expect(second.nonce).toBeTruthy()
    expect(second.nonce).not.toBe(first.nonce)
    expect(cachedBase?.html).toContain(PREVIEW_HTML_CACHE_NONCE_PLACEHOLDER)
    expect(cachedBase?.html).not.toContain('data-ark-preview-handshake')
    expect(cachedBase?.html).not.toContain('handshake-one')
    expect(first.html).toContain('data-ark-preview-handshake')
    expect(first.html).toContain('handshake-one')
    expect(first.html).not.toContain(PREVIEW_HTML_CACHE_NONCE_PLACEHOLDER)
    expect(second.html).toContain('data-ark-preview-handshake')
    expect(second.html).toContain('handshake-two')
    expect(second.html).not.toContain('handshake-one')
    expect(second.html).not.toContain(PREVIEW_HTML_CACHE_NONCE_PLACEHOLDER)
  })

  it('discriminates cache entries by parent origin and editor bridge mode', () => {
    const cache = createPreviewHtmlCache()
    const first = renderCachedPreviewDocument(
      plainCssDeck,
      {
        parentOrigin: 'http://localhost:5173',
        handshake: 'handshake-one',
      },
      cache,
    )
    const sameKey = renderCachedPreviewDocument(
      plainCssDeck,
      {
        parentOrigin: 'http://localhost:5173',
        handshake: 'handshake-two',
      },
      cache,
    )
    const differentParent = renderCachedPreviewDocument(
      plainCssDeck,
      {
        parentOrigin: 'http://127.0.0.1:5173',
        handshake: 'handshake-three',
      },
      cache,
    )
    const editorBridge = renderCachedPreviewDocument(
      plainCssDeck,
      {
        parentOrigin: 'http://localhost:5173',
        editorBridge: true,
        handshake: 'handshake-four',
      },
      cache,
    )

    expect(first.cacheStatus).toBe('miss')
    expect(sameKey.cacheStatus).toBe('hit')
    expect(differentParent.cacheStatus).toBe('miss')
    expect(editorBridge.cacheStatus).toBe('miss')
    expect(editorBridge.html).toContain('data-ark-preview-editor')
  })

  it('keeps hostile navigation stripping on the cached render path', () => {
    const cache = createPreviewHtmlCache()
    const first = renderCachedPreviewDocument(
      hostileNavigationDeck,
      {
        parentOrigin: 'http://localhost:5173',
        handshake: 'hostile-one',
      },
      cache,
    )
    const second = renderCachedPreviewDocument(
      hostileNavigationDeck,
      {
        parentOrigin: 'http://localhost:5173',
        handshake: 'hostile-two',
      },
      cache,
    )

    expect(first.cacheStatus).toBe('miss')
    expect(second.cacheStatus).toBe('hit')
    expect(second.html.toLowerCase()).not.toContain('http-equiv="refresh"')
    expect(second.html.toLowerCase()).not.toContain('javascript:')
    expect(second.html).not.toContain('window.top.location')
    expect(second.html).not.toContain('onclick=')
    expect(second.html).toContain('data-ark-preview-nav')
    expect(second.html).toContain('hostile-two')
  })
})
