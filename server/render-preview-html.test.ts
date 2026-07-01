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

describe('renderPreviewHtml', () => {
  it('renders css-only and full-js preview HTML on the server', () => {
    const cssOnly = renderPreviewHtml(plainCssDeck, {
      parentOrigin: 'http://localhost:5173',
    })
    const fullJs = renderPreviewHtml(fullJsDeck, {
      parentOrigin: 'http://localhost:5173',
    })

    expect(cssOnly).toContain('data-ark-preview-nav')
    expect(fullJs).toContain('data-ark-preview-bridge')
    expect(fullJs).toContain('PARENT_ORIGIN')
    expect(fullJs).toContain('http://localhost:5173')
  })

  it('strips hostile scripts for static preview decks', () => {
    const previewHtml = renderPreviewHtml(hostileScriptsDeck)

    expect(previewHtml).not.toContain('window.top.location')
    expect(previewHtml).toContain('data-ark-preview-nav')
  })
})
