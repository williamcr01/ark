import { describe, expect, it } from 'vitest'

import { renderPreviewHtml } from './render-preview-html.ts'

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
    expect(previewHtml).toContain('data-ark-preview-nav')
  })
})
