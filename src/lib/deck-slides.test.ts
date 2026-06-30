import { describe, expect, it } from 'vitest'

import hostileScriptsDeck from '@/test/fixtures/hostile-scripts-deck.html?raw'
import malformedDeck from '@/test/fixtures/malformed-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'
import revealDeck from '@/test/fixtures/reveal-deck.html?raw'

import { STRICT_DECK_CSP } from './deck-runtime'
import { parseDeckSlides, stripDeckScriptsForPreview } from './deck-slides'

function parseHtml(html: string) {
  return new DOMParser().parseFromString(html, 'text/html')
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
})

describe('parseDeckSlides', () => {
  it('parses plain CSS deck slides and generates one static thumbnail per slide', () => {
    const parsed = parseDeckSlides(plainCssDeck)

    expect(parsed.slideCount).toBe(3)
    expect(parsed.slides.map((slide) => slide.index)).toEqual([0, 1, 2])
    expect(parsed.slides[0].outerHTML).toContain('Quarterly planning')
    expect(parsed.thumbnailSrcDocs).toHaveLength(3)

    parsed.thumbnailSrcDocs.forEach((srcDoc, index) => {
      const thumbnailDoc = parseHtml(srcDoc)
      const slides = thumbnailDoc.querySelectorAll('section.slide')

      expect(srcDoc).toContain('data-ark-thumb-fill')
      expect(srcDoc).toContain('http-equiv="Content-Security-Policy"')
      expect(srcDoc).toContain(STRICT_DECK_CSP)
      expect(slides).toHaveLength(1)
      expect(slides[0].classList.contains('active')).toBe(true)
      expect(slides[0].getAttribute('aria-hidden')).toBe('false')
      expect(slides[0].getAttribute('data-active')).toBe('')
      expect(slides[0].textContent).toContain(
        ['Quarterly planning', 'Metrics that moved', 'Next decisions'][index],
      )
    })
  })

  it('recognizes Reveal-style slide markup', () => {
    const parsed = parseDeckSlides(revealDeck)

    expect(parsed.slideCount).toBe(2)
    expect(parsed.slides[0].outerHTML).toContain('Reveal opening')
    expect(parsed.slides[1].outerHTML).toContain('Reveal detail')

    const secondThumbnail = parseHtml(parsed.thumbnailSrcDocs[1])
    expect(secondThumbnail.querySelector('.reveal .slides > section')?.textContent).toContain(
      'Reveal detail',
    )
    expect(secondThumbnail.querySelectorAll('.reveal .slides > section')).toHaveLength(1)
  })

  it('sanitizes thumbnail documents for hostile script fixtures', () => {
    const parsed = parseDeckSlides(hostileScriptsDeck)

    expect(parsed.slideCount).toBe(2)
    expect(parsed.headHtml).not.toContain('<script')

    parsed.thumbnailSrcDocs.forEach((srcDoc) => {
      const thumbnailDoc = parseHtml(srcDoc)

      expect(srcDoc).not.toContain('<script')
      expect(thumbnailDoc.body.hasAttribute('onload')).toBe(false)
      expect(thumbnailDoc.querySelector('section.slide')?.hasAttribute('onclick')).toBe(false)
      expect(thumbnailDoc.querySelector('img')?.hasAttribute('onerror') ?? false).toBe(false)
    })
  })

  it('handles malformed but recoverable HTML without throwing', () => {
    const parsed = parseDeckSlides(malformedDeck)

    expect(parsed.slideCount).toBe(2)
    expect(parsed.slides[0].outerHTML).toContain('Recovered opening')
    expect(parsed.slides[1].outerHTML).toContain('Recovered detail')
    expect(parsed.thumbnailSrcDocs).toHaveLength(2)
  })

  it('returns an empty deck when no slide selector matches', () => {
    const parsed = parseDeckSlides('<html><body><article>No slides</article></body></html>')

    expect(parsed.slideCount).toBe(0)
    expect(parsed.slides).toEqual([])
    expect(parsed.thumbnailSrcDocs).toEqual([])
  })
})
