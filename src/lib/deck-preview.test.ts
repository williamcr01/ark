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
import revealRegistryDeck from '@/test/fixtures/reveal-registry-deck.html?raw'
import revealVerticalDeck from '@/test/fixtures/reveal-vertical-deck.html?raw'

import { resolveAppOrigin } from '../../shared/sandbox-origin.ts'
import { STRICT_DECK_CSP } from './deck-runtime'
import { detectRuntimeMode, getPreviewHtml, getPreviewSandbox } from './deck-preview'

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

    ;(dom.window as unknown as Window & { __parentMessages: unknown[] }).__parentMessages =
      parentMessages

    dom.window.addEventListener('load', () => resolve(dom))
  })
}

function getParentMessages(dom: JSDOM) {
  return (dom.window as unknown as Window & { __parentMessages: unknown[] }).__parentMessages
}

function buildRevealMockScript(slideCount: number) {
  return `<script data-ark-test-reveal-mock>
(function () {
  var currentIndex = 0;
  var listeners = [];
  var slides = [];

  for (var i = 0; i < ${slideCount}; i++) {
  var slide = document.createElement('section');
  slide.dataset.linearIndex = String(i);
  slides.push(slide);
  }

  function notify() {
    listeners.forEach(function (handler) {
      handler({ currentSlide: slides[currentIndex] });
    });
  }

  window.Reveal = {
    initialize: function () {
      return Promise.resolve();
    },
    on: function (event, handler) {
      if (event === 'slidechanged') {
        listeners.push(handler);
      }
    },
    getSlides: function () {
      return slides;
    },
    getTotalSlides: function () {
      return slides.length;
    },
    getCurrentSlide: function () {
      return slides[currentIndex];
    },
    getSlidePastCount: function (slide) {
      return slides.indexOf(slide);
    },
    getIndices: function (slide) {
      var index = slides.indexOf(slide || slides[currentIndex]);
      return { h: index, v: 0, f: 0 };
    },
    slide: function (h) {
      currentIndex = Math.max(0, Math.min(slides.length - 1, h));
      notify();
    },
  };
})();</script>`
}

function prepareRevealAdapterPreview(html: string, slideCount: number) {
  const previewHtml = getPreviewHtml(html, { parentOrigin: 'http://localhost:5173' })

  return previewHtml.replace(
    /<script[^>]*reveal\.js[^>]*><\/script>/i,
    buildRevealMockScript(slideCount),
  )
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
    expect(detectRuntimeMode('<html><body data-ark-preview="full-js"></body></html>')).toBe(
      'custom-js',
    )
    expect(detectRuntimeMode('<html><body><script>window.x = 1</script></body></html>')).toBe(
      'static',
    )
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
    expect(previewHtml).not.toContain('data-ark-preview-editor')
    expect(previewHtml).toContain('Content-Security-Policy')
    expect(previewHtml).toContain("connect-src 'none'")
    expect(previewHtml).not.toContain('data-ark-preview-bridge')
    expect(previewHtml).not.toContain('window.evilHead')
    expect(previewHtml).not.toContain('window.evilModule')
    expect(previewHtml).not.toContain('onload=')
    expect(previewHtml).not.toContain('onclick=')
    expect(previewHtml).not.toContain('onerror=')
  })

  it('injects the editor bridge only when preview opts in', () => {
    const withoutEditor = getPreviewHtml(plainCssDeck)
    const withEditor = getPreviewHtml(plainCssDeck, { editorBridge: true })

    expect(withoutEditor).not.toContain('data-ark-preview-editor')
    expect(withEditor).toContain('data-ark-preview-editor')
    expect(withEditor).toContain('data-ark-preview-nav')
    expect(withEditor).toContain("connect-src 'none'")
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

    document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'ArrowRight',
      }),
    )

    expect(slides[0].hasAttribute('data-ark-hidden')).toBe(true)
    expect(slides[1].getAttribute('data-ark-active')).toBe('')
    expect(slides[1].getAttribute('aria-hidden')).toBe('false')
  })

  it('announces deck-ready, slide-count, and metadata for static previews', async () => {
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

  it('detects reveal runtime metadata in static previews', async () => {
    const dom = await loadExecutablePreview(getPreviewHtml(revealDeck))
    const metadataMessage = getParentMessages(dom).find(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === DECK_METADATA_MESSAGE_TYPE,
    ) as { metadata: { runtime: string } } | undefined

    expect(metadataMessage?.metadata.runtime).toBe('reveal')
  })

  it('allows approved runtime assets and injects the reveal adapter for registry decks', () => {
    const previewHtml = getPreviewHtml(revealRegistryDeck, {
      parentOrigin: 'http://localhost:5173',
    })

    expect(previewHtml).toContain(
      'src="http://localhost:5173/api/runtimes/reveal.js/5.1.0/reveal.js"',
    )
    expect(previewHtml).toContain(
      'href="http://localhost:5173/api/runtimes/reveal.js/5.1.0/reveal.css"',
    )
    expect(previewHtml).toContain('http://localhost:5173/api/runtimes/reveal.js/5.1.0/reveal.js')
    expect(previewHtml).toContain('http://localhost:5173/api/runtimes/reveal.js/5.1.0/reveal.css')
    expect(previewHtml).toContain(
      'http://localhost:5173/api/runtimes/reveal.js/5.1.0/theme/white.css',
    )
    expect(previewHtml).toContain("connect-src 'none'")
    expect(previewHtml).toContain('data-ark-preview-reveal')
    expect(previewHtml).not.toContain('data-ark-preview-nav')
  })

  it('keeps structure-only reveal decks on the CSS navigation shim', () => {
    const previewHtml = getPreviewHtml(revealDeck)

    expect(previewHtml).toContain('data-ark-preview-nav')
    expect(previewHtml).not.toContain('data-ark-preview-reveal')
  })

  it('initializes the reveal adapter once and announces reveal metadata', async () => {
    const dom = await loadExecutablePreview(prepareRevealAdapterPreview(revealRegistryDeck, 2))
    const messages = getParentMessages(dom)

    expect(messages).toContainEqual({
      type: DECK_READY_MESSAGE_TYPE,
      index: 0,
      slideCount: 2,
      metadata: expect.objectContaining({
        runtime: 'reveal',
        previewMode: 'full-js',
      }),
    })
    expect(dom.window.document.querySelectorAll('[data-ark-preview-reveal]').length).toBe(1)
  })

  it('navigates reveal decks from parent goto messages and reports slide changes', async () => {
    const dom = await loadExecutablePreview(prepareRevealAdapterPreview(revealRegistryDeck, 2))
    const appOrigin = resolveAppOrigin()

    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: { type: DECK_GOTO_MESSAGE_TYPE, index: 1 },
        origin: appOrigin,
        source: dom.window.parent as unknown as Window,
      }),
    )

    await new Promise((resolve) => {
      dom.window.setTimeout(resolve, 0)
    })

    expect(getParentMessages(dom)).toContainEqual({
      type: DECK_SLIDE_CHANGE_MESSAGE_TYPE,
      index: 1,
    })
  })

  it('uses the reveal adapter for vertical registry decks', () => {
    const previewHtml = getPreviewHtml(revealVerticalDeck, {
      parentOrigin: 'http://localhost:5173',
    })

    expect(previewHtml).toContain('data-ark-preview-reveal')
    expect(previewHtml).not.toContain('data-ark-preview-nav')
  })

  it('still strips unapproved scripts from reveal previews', () => {
    const previewHtml = getPreviewHtml(
      revealRegistryDeck.replace(
        '</body>',
        '<script>window.unapprovedRevealCode = true</script></body>',
      ),
      { parentOrigin: 'http://localhost:5173' },
    )

    expect(previewHtml).toContain(
      'src="http://localhost:5173/api/runtimes/reveal.js/5.1.0/reveal.js"',
    )
    expect(previewHtml).not.toContain('window.unapprovedRevealCode')
  })

  it('bridges parent goto messages into deck CustomEvents for custom-js previews', async () => {
    const dom = await loadExecutablePreview(getPreviewHtml(fullJsDeck))
    const receivedIndexes: number[] = []
    const appOrigin = resolveAppOrigin()

    dom.window.document.addEventListener(DECK_GOTO_EVENT, (event) => {
      receivedIndexes.push((event as CustomEvent<{ index: number }>).detail.index)
    })

    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: { type: DECK_GOTO_MESSAGE_TYPE, index: 1 },
        origin: appOrigin,
        source: dom.window.parent as unknown as Window,
      }),
    )

    expect(receivedIndexes).toEqual([1])
  })

  it('announces deck-ready for custom-js previews', async () => {
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

  it('forwards slide-change CustomEvents to the parent in custom-js previews', async () => {
    const dom = await loadExecutablePreview(getPreviewHtml(fullJsDeck))

    dom.window.document.dispatchEvent(
      new dom.window.CustomEvent(DECK_SLIDE_CHANGE_MESSAGE_TYPE, {
        detail: { index: 1 },
      }),
    )

    expect(getParentMessages(dom)).toContainEqual({
      type: DECK_SLIDE_CHANGE_MESSAGE_TYPE,
      index: 1,
    })
  })

  it('reports runtime errors to the parent', async () => {
    const dom = await loadExecutablePreview(getPreviewHtml(plainCssDeck))

    dom.window.dispatchEvent(
      new dom.window.ErrorEvent('error', {
        message: 'Preview failed',
        filename: 'deck.js',
      }),
    )

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

describe('getPreviewSandbox', () => {
  it('allows scripts without same-origin or other risky permissions', () => {
    expect(getPreviewSandbox('static')).toBe('allow-scripts')
    expect(getPreviewSandbox('reveal')).toBe('allow-scripts')
    expect(getPreviewSandbox('custom-js')).toBe('allow-scripts')
    expect(getPreviewSandbox('custom-js')).not.toContain('allow-same-origin')
  })
})
