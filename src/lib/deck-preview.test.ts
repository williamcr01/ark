import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import fullJsDeck from '@/test/fixtures/full-js-deck.html?raw'
import hostileScriptsDeck from '@/test/fixtures/hostile-scripts-deck.html?raw'
import malformedDeck from '@/test/fixtures/malformed-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'

import {
  DECK_GOTO_EVENT,
  DECK_GOTO_MESSAGE_TYPE,
  detectPreviewMode,
  getPreviewHtml,
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

describe('detectPreviewMode', () => {
  it('defaults blank, plain CSS, malformed, and hostile-script decks to css-only', () => {
    expect(detectPreviewMode('')).toBe('css-only')
    expect(detectPreviewMode(plainCssDeck)).toBe('css-only')
    expect(detectPreviewMode(malformedDeck)).toBe('css-only')
    expect(detectPreviewMode(hostileScriptsDeck)).toBe('css-only')
  })

  it('enables full-js only when an explicit Ark marker is present', () => {
    expect(detectPreviewMode(fullJsDeck)).toBe('full-js')
    expect(detectPreviewMode('<html><body data-ark-preview="full-js"></body></html>'))
      .toBe('full-js')
    expect(detectPreviewMode('<html><body><script>window.x = 1</script></body></html>'))
      .toBe('css-only')
  })
})

describe('getPreviewHtml', () => {
  it('strips deck scripts and injects the CSS-only navigation shim by default', () => {
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

  it('keeps deck scripts and injects only the bridge for explicit full-js decks', () => {
    const previewHtml = getPreviewHtml(fullJsDeck)

    expect(previewHtml).toContain('data-ark-preview-fill')
    expect(previewHtml).toContain('data-ark-preview-history-shim')
    expect(previewHtml).toContain('data-ark-preview-bridge')
    expect(previewHtml).not.toContain('data-ark-preview-nav')
    expect(previewHtml).toContain('window.fullJsDeckBooted = true')
  })

  it('runs the CSS-only navigation shim for keyboard navigation', async () => {
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

  it('bridges parent goto messages into deck CustomEvents for full-js previews', async () => {
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
