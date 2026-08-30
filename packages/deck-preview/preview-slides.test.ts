// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { stripDeckScriptsForPreview, stripHostileNavigationFromHtml } from './preview-slides.ts'

function parseHtml(html: string) {
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('stripHostileNavigationFromHtml', () => {
  it('removes meta refresh and javascript: URL attributes', () => {
    const hostile = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="refresh" content="0;url=https://evil.example/" />
  <meta HTTP-EQUIV="Refresh" content="5;url=https://evil.example/upper" />
</head>
<body>
  <section class="slide">
    <a href="javascript:alert(1)">js</a>
    <a href="  JavaScript:void(0)">spaced</a>
    <a href="https://example.com">safe</a>
  </section>
</body>
</html>`
    const stripped = stripHostileNavigationFromHtml(hostile)
    const doc = parseHtml(stripped)

    expect(stripped.toLowerCase()).not.toContain('http-equiv="refresh"')
    expect(stripped).not.toContain('javascript:')
    expect(doc.querySelectorAll('a[href="https://example.com"]')).toHaveLength(1)
    expect(doc.querySelector('a[href="javascript:alert(1)"]')).toBeNull()
  })

  it('preserves root html/body on* handlers for custom-js decks', () => {
    const customJs = `<!DOCTYPE html>
<html lang="en" data-ark-deck="nav" onclick="window.htmlClicked = true">
<head>
  <meta charset="UTF-8" />
  <title>Custom</title>
</head>
<body onload="window.boot = true" data-kind="custom">
  <section class="slide">
    <a href="javascript:alert(1)">js</a>
    <button onclick="window.childClicked = true">ok</button>
  </section>
</body>
</html>`
    const stripped = stripHostileNavigationFromHtml(customJs)
    const doc = parseHtml(stripped)

    expect(doc.documentElement.getAttribute('onclick')).toBe('window.htmlClicked = true')
    expect(doc.documentElement.getAttribute('data-ark-deck')).toBe('nav')
    expect(doc.body.getAttribute('onload')).toBe('window.boot = true')
    expect(doc.body.getAttribute('data-kind')).toBe('custom')
    expect(stripped).not.toContain('javascript:')
    expect(doc.querySelector('a[href="javascript:alert(1)"]')).toBeNull()
    // Child on* handlers are not navigation vectors; navigation-only path keeps them.
    expect(doc.querySelector('button')?.getAttribute('onclick')).toBe('window.childClicked = true')
  })

  it('returns blank input unchanged', () => {
    expect(stripHostileNavigationFromHtml('   ')).toBe('   ')
    expect(stripHostileNavigationFromHtml('')).toBe('')
  })
})

describe('stripDeckScriptsForPreview', () => {
  it('still strips root html/body on* handlers for static/reveal paths', () => {
    const hostile = `<!DOCTYPE html>
<html lang="en" onclick="window.htmlClicked = true">
<head>
  <meta http-equiv="refresh" content="0;url=https://evil.example/" />
  <script>window.evil = true</script>
</head>
<body onload="window.boot = true">
  <section class="slide">
    <a href="javascript:alert(1)">js</a>
    <img src="x" onerror="window.imgEvil = true" />
  </section>
</body>
</html>`
    const stripped = stripDeckScriptsForPreview(hostile)
    const doc = parseHtml(stripped)

    expect(doc.documentElement.hasAttribute('onclick')).toBe(false)
    expect(doc.body.hasAttribute('onload')).toBe(false)
    expect(stripped).not.toContain('<script')
    expect(stripped.toLowerCase()).not.toContain('http-equiv="refresh"')
    expect(stripped).not.toContain('javascript:')
    expect(doc.querySelector('img')?.hasAttribute('onerror')).toBe(false)
  })
})
