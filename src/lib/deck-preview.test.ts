import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import fullJsDeck from '@/test/fixtures/full-js-deck.html?raw'
import hostileScriptsDeck from '@/test/fixtures/hostile-scripts-deck.html?raw'
import malformedDeck from '@/test/fixtures/malformed-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'
import revealDeck from '@/test/fixtures/reveal-deck.html?raw'

import { STRICT_DECK_CSP } from './deck-runtime'
import {
  DECK_GOTO_EVENT,
  DECK_GOTO_MESSAGE_TYPE,
  detectRuntimeMode,
  getPreviewHtml,
  getPreviewSandbox,
} from './deck-preview'

function loadExecutablePreview(html: string) {
  return new Promise<JSDOM>((resolve) => {
    const dom = new JSDOM(html, {
      pretendToBeVisual: true,
      runScripts: 'dangerously',
      url: 'https://ark.test/preview',
    })

    dom.window.addEventListener('load', () => resolve(dom))
  })
}

describe('detectRuntimeMode', () => {
  it('defaults blank, plain CSS, malformed, and hostile-script decks to static', () => {
    expect(detectRuntimeMode('')).toBe('static')
    expect(detectRuntimeMode(plainCssDeck)).toBe('static')
    expect(detectRuntimeMode(malformedDeck)).toBe('static')
    expect(detectRuntimeMode(hostileScriptsDeck)).toBe('static')
  })

  it('detects reveal decks from structure', () => {
    expect(detectRuntimeMode(revealDeck)).toBe('reveal')
  })

  it('enables custom-js only when an explicit Ark marker is present', () => {
    expect(detectRuntimeMode(fullJsDeck)).toBe('custom-js')
    expect(detectRuntimeMode('<html><body data-ark-preview="full-js"></body></html>'))
      .toBe('custom-js')
    expect(detectRuntimeMode('<html><body><script>window.x = 1</script></body></html>'))
      .toBe('static')
  })
})

describe('getPreviewHtml', () => {
  it('injects strict CSP for every preview document', () => {
    const previewHtml = getPreviewHtml(plainCssDeck)

    expect(previewHtml).toContain('http-equiv="Content-Security-Policy"')
    expect(previewHtml).toContain(STRICT_DECK_CSP)
    expect(previewHtml).toContain("connect-src 'none'")
  })

  it('strips deck scripts and injects the static navigation shim by default', () => {
    const previewHtml = getPreviewHtml(hostileScriptsDeck)

    expect(previewHtml).toContain('data-ark-preview-fill')
    expect(previewHtml).toContain('data-ark-preview-nav')
    expect(previewHtml).not.toContain('data-ark-preview-bridge')
    expect(previewHtml).not.toContain('window.evilHead')
    expect(previewHtml).not.toContain('window.evilModule')
    expect(previewHtml).not.toContain('onload=')
    expect(previewHtml).not.toContain('onclick=')
    expect(previewHtml).not.toContain('onerror=')
  })

  it('keeps deck scripts and injects only the bridge for explicit custom-js decks', () => {
    const previewHtml = getPreviewHtml(fullJsDeck)

    expect(previewHtml).toContain('data-ark-preview-fill')
    expect(previewHtml).toContain('data-ark-preview-history-shim')
    expect(previewHtml).toContain('data-ark-preview-bridge')
    expect(previewHtml).not.toContain('data-ark-preview-nav')
    expect(previewHtml).toContain('window.fullJsDeckBooted = true')
  })

  it('runs the static navigation shim for keyboard navigation', async () => {
    const dom = await loadExecutablePreview(getPreviewHtml(plainCssDeck))
    const { document } = dom.window
    const slides = [...document.querySelectorAll('section.slide')]

    expect(slides[0].getAttribute('data-ark-active')).toBe('')
    expect(slides[0].getAttribute('aria-hidden')).toBe('false')
    expect(slides[1].hasAttribute('data-ark-hidden')).toBe(true)

    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowRight',
    }))

    expect(slides[0].hasAttribute('data-ark-hidden')).toBe(true)
    expect(slides[1].getAttribute('data-ark-active')).toBe('')
    expect(slides[1].getAttribute('aria-hidden')).toBe('false')
  })

  it('bridges parent goto messages into deck CustomEvents for custom-js previews', async () => {
    const dom = await loadExecutablePreview(getPreviewHtml(fullJsDeck))
    const receivedIndexes: number[] = []

    dom.window.document.addEventListener(DECK_GOTO_EVENT, (event) => {
      receivedIndexes.push((event as CustomEvent<{ index: number }>).detail.index)
    })

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: DECK_GOTO_MESSAGE_TYPE, index: 1 },
      source: dom.window.parent as Window,
    }))

    expect(receivedIndexes).toEqual([1])
  })

  it('returns an empty preview for empty HTML', () => {
    expect(getPreviewHtml('')).toBe('')
  })
})

describe('getPreviewSandbox', () => {
  it('allows scripts without same-origin or other risky permissions', () => {
    expect(getPreviewSandbox('static')).toBe('allow-scripts')
    expect(getPreviewSandbox('reveal')).toBe('allow-scripts')
    expect(getPreviewSandbox('custom-js')).toBe('allow-scripts')
    expect(getPreviewSandbox('custom-js')).not.toContain('allow-same-origin')
  })
})
