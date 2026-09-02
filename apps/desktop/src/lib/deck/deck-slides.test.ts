import { describe, expect, it } from 'vitest'

import hostileScriptsDeck from '@fixtures/hostile-scripts-deck.html?raw'
import malformedDeck from '@fixtures/malformed-deck.html?raw'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'
import revealDeck from '@fixtures/reveal-deck.html?raw'
import revealFragmentsDeck from '@fixtures/reveal-fragments-deck.html?raw'
import revealRegistryDeck from '@fixtures/reveal-registry-deck.html?raw'
import revealVerticalDeck from '@fixtures/reveal-vertical-deck.html?raw'

import { parseDeckSlides, stripDeckScriptsForPreview } from './deck-slides'
import { configureVitestRuntimeStylesheets } from '@ark/runtime-registry/runtime-stylesheet-disk.ts'
import { resetRuntimeStylesheetMap } from '@ark/runtime-registry/runtime-stylesheet-content.ts'

function parseHtml(html: string) {
  return new DOMParser().parseFromString(html, 'text/html')
}

function getThumbnailSrcDocs(parsed: ReturnType<typeof parseDeckSlides>) {
  return Array.from({ length: parsed.slideCount }, (_, index) => parsed.getThumbnailSrcDoc(index))
}

function expectStrictThumbnailCsp(srcDoc: string) {
  expect(srcDoc).toContain('http-equiv="Content-Security-Policy"')
  expect(srcDoc).toContain("connect-src 'none'")
  // Thumbnails use a per-render nonce (no script-src 'unsafe-inline').
  expect(srcDoc).toMatch(/script-src[^;]*'nonce-/)
  expect(srcDoc).not.toMatch(/script-src[^;]*'unsafe-inline'/)
}

function expectThumbnailSecurity(srcDoc: string) {
  const thumbnailDoc = parseHtml(srcDoc)

  expect(srcDoc).not.toContain('<script')
  expect(srcDoc).toContain('http-equiv="Content-Security-Policy"')
  expect(srcDoc).not.toContain('onclick=')
  expect(srcDoc).not.toContain('onload=')
  expect(srcDoc).not.toContain('onerror=')
  expect(srcDoc.toLowerCase()).not.toContain('http-equiv="refresh"')
  expect(srcDoc).not.toContain('javascript:')
  expect(thumbnailDoc.body.hasAttribute('onload')).toBe(false)
}

describe('stripDeckScriptsForPreview', () => {
  it('removes scripts and inline event handlers from hostile decks', () => {
    const stripped = stripDeckScriptsForPreview(hostileScriptsDeck)
    const doc = parseHtml(stripped)

    expect(stripped).not.toContain('<script')
    expect(stripped).not.toContain('window.evilHead')
    expect(stripped).not.toContain('window.evilModule')
    expect(doc.documentElement.hasAttribute('onclick')).toBe(false)
    expect(doc.body.hasAttribute('onload')).toBe(false)
    expect(doc.querySelector('section.slide')?.hasAttribute('onclick')).toBe(false)
    expect(doc.querySelector('img')?.hasAttribute('onerror')).toBe(false)
  })

  it('keeps deck attributes and slide markup when stripping executable code', () => {
    const stripped = stripDeckScriptsForPreview(plainCssDeck)
    const doc = parseHtml(stripped)

    expect(doc.documentElement.getAttribute('lang')).toBe('en')
    expect(doc.documentElement.getAttribute('data-deck')).toBe('plain-css')
    expect(doc.body.getAttribute('data-kind')).toBe('plain')
    expect(doc.querySelectorAll('section.slide')).toHaveLength(3)
    expect(doc.querySelector('style')?.textContent).toContain('section.slide')
  })

  it('returns an empty string for blank input', () => {
    expect(stripDeckScriptsForPreview('   ')).toBe('')
  })

  it('removes meta refresh and javascript: URLs', () => {
    const hostile = `<!DOCTYPE html>
<html lang="en">
<head>
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
    const stripped = stripDeckScriptsForPreview(hostile)
    const doc = parseHtml(stripped)

    expect(stripped.toLowerCase()).not.toContain('http-equiv="refresh"')
    expect(stripped).not.toContain('javascript:')
    expect(doc.querySelectorAll('a[href="https://example.com"]')).toHaveLength(1)
    expect(doc.querySelector('a[href="javascript:alert(1)"]')).toBeNull()
  })

  it('preserves approved runtime scripts only when requested', () => {
    const stripped = stripDeckScriptsForPreview(revealRegistryDeck)
    const preserved = stripDeckScriptsForPreview(revealRegistryDeck, {
      preserveApprovedRuntimeScripts: true,
    })

    expect(stripped).not.toContain('src="/api/runtimes/reveal.js/5.1.0/reveal.js"')
    expect(preserved).toContain('src="/api/runtimes/reveal.js/5.1.0/reveal.js"')
  })
})

describe('parseDeckSlides', () => {
  it('changes the fallback shared key only for cross-slide influences', () => {
    const before = parseDeckSlides(`
      <html>
        <head><style>.slide { color: navy; }</style></head>
        <body>
          <section class="slide"><h1>Before</h1></section>
          <section class="slide"><p>Unchanged</p></section>
        </body>
      </html>
    `)
    const copyEdit = parseDeckSlides(`
      <html>
        <head><style>.slide { color: navy; }</style></head>
        <body>
          <section class="slide"><h1>After</h1></section>
          <section class="slide"><p>Unchanged</p></section>
        </body>
      </html>
    `)
    const sharedStyleEdit = parseDeckSlides(`
      <html>
        <head><style>.slide { color: maroon; }</style></head>
        <body>
          <section class="slide"><h1>After</h1></section>
          <section class="slide"><p>Unchanged</p></section>
        </body>
      </html>
    `)

    expect(copyEdit.thumbnailSharedKey).toBe(before.thumbnailSharedKey)
    expect(sharedStyleEdit.thumbnailSharedKey).not.toBe(before.thumbnailSharedKey)
  })

  it('includes shared body markup in the fallback thumbnail key', () => {
    const before = parseDeckSlides(`
      <main class="deck light">
        <section class="slide"><h1>One</h1></section>
        <section class="slide"><h1>Two</h1></section>
      </main>
    `)
    const sharedWrapperEdit = parseDeckSlides(`
      <main class="deck dark">
        <section class="slide"><h1>One</h1></section>
        <section class="slide"><h1>Two</h1></section>
      </main>
    `)

    expect(sharedWrapperEdit.thumbnailSharedKey).not.toBe(before.thumbnailSharedKey)
  })

  it('parses plain CSS deck slides and generates one static thumbnail per slide', () => {
    const parsed = parseDeckSlides(plainCssDeck)

    expect(parsed.slideCount).toBe(3)
    expect(parsed.slides.map((slide) => slide.index)).toEqual([0, 1, 2])
    expect(parsed.slides[0].outerHTML).toContain('Quarterly planning')
    const thumbnailSrcDocs = getThumbnailSrcDocs(parsed)
    expect(thumbnailSrcDocs).toHaveLength(3)

    thumbnailSrcDocs.forEach((srcDoc, index) => {
      const thumbnailDoc = parseHtml(srcDoc)
      const slides = thumbnailDoc.querySelectorAll('section.slide')

      expect(srcDoc).toContain('data-ark-thumb-fill')
      expect(srcDoc).toContain('data-ark-metric-fonts')
      expect(srcDoc).toContain('/api/runtimes/deck-fonts/1.0.0/carlito/')
      expectStrictThumbnailCsp(srcDoc)
      expectThumbnailSecurity(srcDoc)
      expect(slides).toHaveLength(1)
      expect(slides[0].classList.contains('active')).toBe(true)
      expect(slides[0].getAttribute('aria-hidden')).toBe('false')
      expect(slides[0].getAttribute('data-active')).toBe('')
      expect(slides[0].textContent).toContain(
        ['Quarterly planning', 'Metrics that moved', 'Next decisions'][index],
      )
    })
  })

  it('resolves workspace assets in fallback thumbnail documents', () => {
    const deckId = '00000000-0000-4000-8000-000000000002'
    const assetId = '00000000-0000-4000-8000-000000000001'
    const parsed = parseDeckSlides(
      `<section class="slide"><img src="ark-asset:${assetId}" alt="Chart"></section>`,
      { assetOrigin: 'http://localhost:8787', deckId },
    )

    const srcDoc = parsed.getThumbnailSrcDoc(0)
    expect(srcDoc).not.toContain('ark-asset:')
    expect(srcDoc).toContain(`http://localhost:8787/api/decks/${deckId}/assets/${assetId}`)
  })

  it('recognizes Reveal-style slide markup and preserves wrapper structure', () => {
    const parsed = parseDeckSlides(revealDeck)

    expect(parsed.slideCount).toBe(2)
    expect(parsed.slides[0].outerHTML).toContain('Reveal opening')
    expect(parsed.slides[1].outerHTML).toContain('Reveal detail')

    getThumbnailSrcDocs(parsed).forEach((srcDoc) => {
      const thumbnailDoc = parseHtml(srcDoc)

      expect(thumbnailDoc.querySelector('.reveal .slides')).not.toBeNull()
      expect(thumbnailDoc.querySelectorAll('.reveal .slides section.present')).toHaveLength(1)
      expect(srcDoc).toContain('data-ark-reveal-thumb-shim')
      expectThumbnailSecurity(srcDoc)
    })

    const secondThumbnail = parseHtml(parsed.getThumbnailSrcDoc(1))
    const selectedSlide = secondThumbnail.querySelector('.reveal .slides > section')

    expect(selectedSlide?.textContent).toContain('Reveal detail')
    expect(selectedSlide?.classList.contains('present')).toBe(true)
    expect(secondThumbnail.querySelectorAll('.reveal .slides > section')).toHaveLength(1)
  })

  it('flattens reveal vertical slide stacks into a linear slide list', () => {
    const parsed = parseDeckSlides(revealVerticalDeck)

    expect(parsed.slideCount).toBe(4)
    expect(parsed.slides.map((slide) => slide.outerHTML)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Opening'),
        expect.stringContaining('Vertical one'),
        expect.stringContaining('Vertical two'),
        expect.stringContaining('Closing'),
      ]),
    )
    expect(getThumbnailSrcDocs(parsed)).toHaveLength(4)
  })

  it('renders one selected vertical slide per thumbnail without duplicate visible slides', () => {
    const parsed = parseDeckSlides(revealVerticalDeck)
    const expectedTitles = ['Opening', 'Vertical one', 'Vertical two', 'Closing']

    getThumbnailSrcDocs(parsed).forEach((srcDoc, index) => {
      const thumbnailDoc = parseHtml(srcDoc)
      const presentSlides = thumbnailDoc.querySelectorAll(
        '.reveal .slides section.present, .reveal .slides section > section.present',
      )

      expect(presentSlides).toHaveLength(index === 0 || index === 3 ? 1 : 2)
      expect(srcDoc).toContain(expectedTitles[index])
      expect(thumbnailDoc.querySelector('.reveal .slides')).not.toBeNull()

      if (index === 1 || index === 2) {
        const stack = thumbnailDoc.querySelector('.reveal .slides > section.stack')
        const activeVertical = thumbnailDoc.querySelector(
          '.reveal .slides > section.stack > section.present',
        )

        expect(stack).not.toBeNull()
        expect(activeVertical?.textContent).toContain(expectedTitles[index])
        expect(
          thumbnailDoc.querySelectorAll('.reveal .slides > section.stack > section'),
        ).toHaveLength(1)
      }
    })
  })

  it('inlines approved reveal runtime CSS into registry deck thumbnails', () => {
    const parsed = parseDeckSlides(revealRegistryDeck)

    const thumbnailSrcDocs = getThumbnailSrcDocs(parsed)
    expect(thumbnailSrcDocs).toHaveLength(2)

    thumbnailSrcDocs.forEach((srcDoc) => {
      expect(srcDoc).toContain('data-ark-runtime-css="reveal.js@5.1.0/reveal.css"')
      expect(srcDoc).toContain('data-ark-runtime-css="reveal.js@5.1.0/theme/white.css"')
      expect(srcDoc).toContain('.reveal .slides > section.present')
      expect(srcDoc).not.toContain('href="/api/runtimes/reveal.js/5.1.0/reveal.css"')
      expect(srcDoc).not.toContain('href="/api/runtimes/reveal.js/5.1.0/theme/white.css"')
      expectStrictThumbnailCsp(srcDoc)
      expect(srcDoc).toContain('data-ark-reveal-thumb-shim')
      expectThumbnailSecurity(srcDoc)
    })
  })

  it('keeps runtime stylesheet links when approved CSS is unavailable', () => {
    resetRuntimeStylesheetMap()

    try {
      const parsed = parseDeckSlides(revealRegistryDeck)

      expect(parsed.getThumbnailSrcDoc(0)).toContain(
        'href="/api/runtimes/reveal.js/5.1.0/reveal.css"',
      )
      expect(parsed.getThumbnailSrcDoc(0)).toContain(
        'href="/api/runtimes/reveal.js/5.1.0/theme/white.css"',
      )
      expect(parsed.getThumbnailSrcDoc(0)).not.toContain('data-ark-runtime-css=')
      // Without inlined CSS the CSP includes approved runtime asset URLs (not the
      // static STRICT_DECK_CSP baseline), still with a per-render nonce.
      expect(parsed.getThumbnailSrcDoc(0)).toMatch(/script-src[^;]*'nonce-/)
      expect(parsed.getThumbnailSrcDoc(0)).toContain(
        'http://localhost:5173/api/runtimes/reveal.js/5.1.0/reveal.css',
      )
    } finally {
      configureVitestRuntimeStylesheets()
    }
  })

  it('shows all fragments in a single thumbnail and keeps background attributes', () => {
    const parsed = parseDeckSlides(revealFragmentsDeck)

    expect(parsed.slideCount).toBe(2)

    const fragmentThumbnail = parseHtml(parsed.getThumbnailSrcDoc(0))
    const fragments = fragmentThumbnail.querySelectorAll('.fragment')

    expect(fragments).toHaveLength(2)
    fragments.forEach((fragment) => {
      expect(fragment.classList.contains('visible')).toBe(true)
    })

    const backgroundThumbnail = parseHtml(parsed.getThumbnailSrcDoc(1))
    const backgroundSlide = backgroundThumbnail.querySelector(
      '.reveal .slides section[data-background-color]',
    )

    expect(backgroundSlide?.getAttribute('data-background-color')).toBe('#223344')
    expect(backgroundSlide?.textContent).toContain('Background slide')
  })

  it('sanitizes thumbnail documents for hostile script fixtures', () => {
    const parsed = parseDeckSlides(hostileScriptsDeck)

    expect(parsed.slideCount).toBe(2)
    expect(parsed.headHtml).not.toContain('<script')

    getThumbnailSrcDocs(parsed).forEach((srcDoc) => {
      const thumbnailDoc = parseHtml(srcDoc)

      expectThumbnailSecurity(srcDoc)
      expect(thumbnailDoc.querySelector('section.slide')?.hasAttribute('onclick')).toBe(false)
      expect(thumbnailDoc.querySelector('img')?.hasAttribute('onerror') ?? false).toBe(false)
    })
  })

  it('handles malformed but recoverable HTML without throwing', () => {
    const parsed = parseDeckSlides(malformedDeck)

    expect(parsed.slideCount).toBe(2)
    expect(parsed.slides[0].outerHTML).toContain('Recovered opening')
    expect(parsed.slides[1].outerHTML).toContain('Recovered detail')
    expect(getThumbnailSrcDocs(parsed)).toHaveLength(2)
  })

  it('returns an empty deck when no slide selector matches', () => {
    const parsed = parseDeckSlides('<html><body><article>No slides</article></body></html>')

    expect(parsed.slideCount).toBe(0)
    expect(parsed.slides).toEqual([])
    expect(getThumbnailSrcDocs(parsed)).toEqual([])
    expect(parsed.getThumbnailSrcDoc(0)).toBe('')
  })
})
