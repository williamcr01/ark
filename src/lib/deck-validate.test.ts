import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import fullJsDeck from '@/test/fixtures/full-js-deck.html?raw'
import hostileScriptsDeck from '@/test/fixtures/hostile-scripts-deck.html?raw'
import malformedDeck from '@/test/fixtures/malformed-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'
import revealDeck from '@/test/fixtures/reveal-deck.html?raw'

import {
  formatDeckValidationSummary,
  validateDeckHtml,
  validateDeckHtmlInBrowser,
} from './deck-validate'

describe('validateDeckHtmlInBrowser', () => {
  it('accepts a plain CSS deck and reports slide metadata', () => {
    const report = validateDeckHtmlInBrowser(plainCssDeck)

    expect(report.valid).toBe(true)
    expect(report.slideCount).toBe(3)
    expect(report.scripts).toEqual([])
    expect(report.forms).toBe(0)
    expect(report.iframes).toBe(0)
    expect(report.runtimeMarkers.runtimeMode).toBe('static')
    expect(report.issues).toEqual([])
    expect(formatDeckValidationSummary(report)).toBe('3 slides')
  })

  it('reports scripts and custom-js runtime markers for opted-in decks', () => {
    const report = validateDeckHtmlInBrowser(fullJsDeck)

    expect(report.valid).toBe(true)
    expect(report.slideCount).toBeGreaterThan(0)
    expect(report.scripts.length).toBeGreaterThan(0)
    expect(report.runtimeMarkers.runtimeMode).toBe('custom-js')
    expect(report.runtimeMarkers.arkDeck).toBe('nav')
    expect(report.issues.some((issue) => issue.code === 'script_without_marker')).toBe(false)
  })

  it('detects reveal decks from structure', () => {
    const report = validateDeckHtmlInBrowser(revealDeck)

    expect(report.valid).toBe(true)
    expect(report.slideCount).toBe(2)
    expect(report.runtimeMarkers.runtimeMode).toBe('reveal')
    expect(formatDeckValidationSummary(report)).toBe('2 slides, reveal runtime')
  })

  it('flags hostile scripts without an Ark runtime marker', () => {
    const report = validateDeckHtmlInBrowser(hostileScriptsDeck)

    expect(report.valid).toBe(true)
    expect(report.scripts.length).toBeGreaterThan(0)
    expect(report.runtimeMarkers.runtimeMode).toBe('static')
    expect(report.issues.some((issue) => issue.code === 'script_without_marker')).toBe(true)
  })

  it('rejects decks with nested slides as malformed', () => {
    const report = validateDeckHtmlInBrowser(malformedDeck)

    expect(report.valid).toBe(false)
    expect(report.slideCount).toBe(2)
    expect(report.malformedSlides.some((slide) => slide.reason === 'nested_slide')).toBe(true)
    expect(report.issues.some((issue) => issue.code === 'nested_slides')).toBe(true)
  })

  it('rejects decks with forms, iframes, and tracking', () => {
    const report = validateDeckHtmlInBrowser(`<!DOCTYPE html>
<html lang="en">
<head><title>Unsafe</title></head>
<body>
  <section class="slide"><h1>Title</h1></section>
  <form><input /></form>
  <iframe src="https://example.com"></iframe>
  <script>gtag('config', 'G-123');</script>
</body>
</html>`)

    expect(report.valid).toBe(false)
    expect(report.forms).toBe(1)
    expect(report.iframes).toBe(1)
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['form', 'iframe', 'tracking', 'script_without_marker']),
    )
  })

  it('reports external URLs as warnings', () => {
    const report = validateDeckHtmlInBrowser(`<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />
</head>
<body>
  <section class="slide">
    <img src="https://example.com/logo.png" alt="Logo" />
  </section>
</body>
</html>`)

    expect(report.valid).toBe(true)
    expect(report.externalUrls).toEqual(
      expect.arrayContaining([
        'https://fonts.googleapis.com/css2?family=Inter',
        'https://example.com/logo.png',
      ]),
    )
    expect(report.issues.some((issue) => issue.code === 'external_url')).toBe(true)
  })

  it('rejects empty HTML', () => {
    const report = validateDeckHtmlInBrowser('')

    expect(report.valid).toBe(false)
    expect(report.slideCount).toBe(0)
    expect(report.issues[0]?.code).toBe('missing_html')
  })
})

describe('validateDeckHtml with JSDOM', () => {
  it('detects runtime modes on the server path without browser DOMParser', () => {
    const parseDocument = (source: string) => new JSDOM(source).window.document

    expect(validateDeckHtml(plainCssDeck, parseDocument).runtimeMarkers.runtimeMode)
      .toBe('static')
    expect(validateDeckHtml(revealDeck, parseDocument).runtimeMarkers.runtimeMode)
      .toBe('reveal')
    expect(validateDeckHtml(fullJsDeck, parseDocument).runtimeMarkers.runtimeMode)
      .toBe('custom-js')
    expect(validateDeckHtml(hostileScriptsDeck, parseDocument).runtimeMarkers.runtimeMode)
      .toBe('static')
  })
})
