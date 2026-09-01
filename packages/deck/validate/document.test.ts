import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import fullJsDeck from '@fixtures/full-js-deck.html?raw'
import hostileScriptsDeck from '@fixtures/hostile-scripts-deck.html?raw'
import malformedDeck from '@fixtures/malformed-deck.html?raw'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'
import revealDeck from '@fixtures/reveal-deck.html?raw'

import {
  sourceMayContainNestedSlides,
  validateDeckDocument,
  validateDeckHtml,
} from '@ark/deck/validate/document.ts'

describe('validateDeckHtml with JSDOM', () => {
  const parseDocument = (source: string) => new JSDOM(source).window.document

  it('detects runtime modes on the server path without browser DOMParser', () => {
    expect(validateDeckHtml(plainCssDeck, parseDocument).runtimeMarkers.runtimeMode).toBe('static')
    expect(validateDeckHtml(revealDeck, parseDocument).runtimeMarkers.runtimeMode).toBe('reveal')
    expect(validateDeckHtml(fullJsDeck, parseDocument).runtimeMarkers.runtimeMode).toBe('custom-js')
    expect(validateDeckHtml(hostileScriptsDeck, parseDocument).runtimeMarkers.runtimeMode).toBe(
      'static',
    )
  })

  it('still flags nested slides when source HTML contains two section tags', () => {
    const report = validateDeckHtml(malformedDeck, parseDocument)

    expect(sourceMayContainNestedSlides(malformedDeck)).toBe(true)
    expect(report.malformedSlides.some((slide) => slide.reason === 'nested_slide')).toBe(true)
    expect(report.issues.some((issue) => issue.code === 'nested_slides')).toBe(true)
  })

  it('still flags nested slides when rawHtml is omitted', () => {
    const doc = parseDocument(malformedDeck)
    const report = validateDeckDocument(doc)

    expect(sourceMayContainNestedSlides(undefined)).toBe(true)
    expect(report.malformedSlides.some((slide) => slide.reason === 'nested_slide')).toBe(true)
  })

  it('skips the nested-slide descendant walk when source has a single section', () => {
    const elements = Array.from({ length: 200 }, (_, index) => {
      return `<div data-ark-id="ark-el-${index}" style="position:absolute;left:${index}px">Item ${index}</div>`
    }).join('')
    const html = `<!DOCTYPE html><html><head><title>Dense</title></head><body><section class="slide">${elements}</section></body></html>`
    const report = validateDeckHtml(html, parseDocument)

    expect(sourceMayContainNestedSlides(html)).toBe(false)
    expect(report.valid).toBe(true)
    expect(report.malformedSlides).toEqual([])
    expect(report.issues.some((issue) => issue.code === 'nested_slides')).toBe(false)
  })

  it('still flags empty slides when the nested-slide walk is skipped', () => {
    const html = `<!DOCTYPE html><html><head><title>Empty</title></head><body><section class="slide">  \n  </section></body></html>`
    const report = validateDeckHtml(html, parseDocument)

    expect(sourceMayContainNestedSlides(html)).toBe(false)
    expect(report.malformedSlides.some((slide) => slide.reason === 'empty')).toBe(true)
    expect(report.issues.some((issue) => issue.code === 'empty_slide')).toBe(true)
  })

  it('still scans when source contains a second section tag even if it is not a slide', () => {
    const html = `<!DOCTYPE html><html><body><section class="slide"><p>See <section class="note">nested mention</section></p></section></body></html>`
    const report = validateDeckHtml(html, parseDocument)

    expect(sourceMayContainNestedSlides(html)).toBe(true)
    expect(report.malformedSlides.some((slide) => slide.reason === 'nested_slide')).toBe(false)
  })
})
