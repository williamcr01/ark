import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  DECK_GOTO_EVENT,
  DECK_GOTO_MESSAGE_TYPE,
  DECK_METADATA_MESSAGE_TYPE,
  DECK_READY_MESSAGE_TYPE,
  DECK_RUNTIME_ERROR_MESSAGE_TYPE,
  DECK_SLIDE_CHANGE_MESSAGE_TYPE,
  DECK_SLIDE_COUNT_MESSAGE_TYPE,
} from '../../shared/deck-bridge.ts'
import fullJsDeck from '@/test/fixtures/full-js-deck.html?raw'
import hostileScriptsDeck from '@/test/fixtures/hostile-scripts-deck.html?raw'
import malformedDeck from '@/test/fixtures/malformed-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'
import revealDeck from '@/test/fixtures/reveal-deck.html?raw'

import {
  detectPreviewMode,
  getPreviewHtml,
} from './deck-preview'

function loadExecutablePreview(html: string) {
  return new Promise<JSDOM>((resolve) => {
    const parentMessages: unknown[] = []
    let parentWindow: { postMessage: (message: unknown) => void }

    const dom = new JSDOM(html, {
      pretendToBeVisual: true,
      runScripts: 'dangerously',
      url: 'https://ark.test/preview',
      beforeParse(window) {
        parentWindow = {
          postMessage(message: unknown) {
            parentMessages.push(message)
          },
        }

        Object.defineProperty(window, 'parent', {
          configurable: true,
          value: parentWindow,
        })
      },
    })

    ;(dom.window as unknown as Window & { __parentMessages: unknown[] }).__parentMessages = parentMessages

    dom.window.addEventListener('load', () => resolve(dom))
  })
}

function getParentMessages(dom: JSDOM) {
  return (dom.window as unknown as Window & { __parentMessages: unknown[] }).__parentMessages
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
    expect(previewHtml).toContain('Content-Security-Policy')
    expect(previewHtml).toContain("connect-src 'none'")
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

  it('announces deck-ready, slide-count, and metadata for CSS-only previews', async () => {
    const dom = await loadExecutablePreview(getPreviewHtml(plainCssDeck))
    const messages = getParentMessages(dom)

    expect(messages).toContainEqual({
      type: DECK_READY_MESSAGE_TYPE,
      index: 0,
      slideCount: 3,
      metadata: expect.objectContaining({
        runtime: 'plain',
        previewMode: 'css-only',
      }),
    })
    expect(messages).toContainEqual({
      type: DECK_SLIDE_COUNT_MESSAGE_TYPE,
      slideCount: 3,
    })
    expect(messages).toContainEqual({
      type: DECK_METADATA_MESSAGE_TYPE,
      metadata: expect.objectContaining({
        runtime: 'plain',
        title: 'Plain CSS Deck',
      }),
    })
  })

  it('detects reveal runtime metadata in CSS-only previews', async () => {
    const dom = await loadExecutablePreview(getPreviewHtml(revealDeck))
    const metadataMessage = getParentMessages(dom).find(
      (message) =>
        typeof message === 'object'
        && message !== null
        && 'type' in message
        && message.type === DECK_METADATA_MESSAGE_TYPE,
    ) as { metadata: { runtime: string } } | undefined

    expect(metadataMessage?.metadata.runtime).toBe('reveal')
  })

  it('bridges parent goto messages into deck CustomEvents for full-js previews', async () => {
    const dom = await loadExecutablePreview(getPreviewHtml(fullJsDeck))
    const receivedIndexes: number[] = []

    dom.window.document.addEventListener(DECK_GOTO_EVENT, (event) => {
      receivedIndexes.push((event as CustomEvent<{ index: number }>).detail.index)
    })

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: DECK_GOTO_MESSAGE_TYPE, index: 1 },
      source: dom.window.parent as unknown as Window,
    }))

    expect(receivedIndexes).toEqual([1])
  })

  it('announces deck-ready for full-js previews', async () => {
    const dom = await loadExecutablePreview(getPreviewHtml(fullJsDeck))
    const messages = getParentMessages(dom)

    expect(messages).toContainEqual({
      type: DECK_READY_MESSAGE_TYPE,
      index: 0,
      slideCount: 2,
      metadata: expect.objectContaining({
        runtime: 'plain',
        previewMode: 'full-js',
      }),
    })
  })

  it('forwards slide-change CustomEvents to the parent in full-js previews', async () => {
    const dom = await loadExecutablePreview(getPreviewHtml(fullJsDeck))

    dom.window.document.dispatchEvent(new dom.window.CustomEvent(DECK_SLIDE_CHANGE_MESSAGE_TYPE, {
      detail: { index: 1 },
    }))

    expect(getParentMessages(dom)).toContainEqual({
      type: DECK_SLIDE_CHANGE_MESSAGE_TYPE,
      index: 1,
    })
  })

  it('reports runtime errors to the parent', async () => {
    const dom = await loadExecutablePreview(getPreviewHtml(plainCssDeck))

    dom.window.dispatchEvent(new dom.window.ErrorEvent('error', {
      message: 'Preview failed',
      filename: 'deck.js',
    }))

    expect(getParentMessages(dom)).toContainEqual({
      type: DECK_RUNTIME_ERROR_MESSAGE_TYPE,
      message: 'Preview failed',
      source: 'deck.js',
    })
  })

  it('returns an empty preview for empty HTML', () => {
    expect(getPreviewHtml('')).toBe('')
  })
})
