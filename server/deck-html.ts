import { JSDOM } from 'jsdom'

import { findSlideElements } from '../src/lib/deck-slides.ts'
import { extractDeckTitle } from './deck-store.ts'

export const DEFAULT_READ_MAX_LINES = 2000
export const DEFAULT_READ_MAX_BYTES = 256 * 1024

export type DeckSlideSummary = {
  index: number
  title: string
  preview: string
}

export type ReadDeckSlice = {
  content: string
  totalLines: number
  offset: number
  limit: number
  truncated: boolean
  hint?: string
}

export function listDeckSlides(html: string): DeckSlideSummary[] {
  if (!html.trim()) {
    return []
  }

  const doc = new JSDOM(html).window.document
  const slideElements = findSlideElements(doc)

  return slideElements.map((element, index) => {
    const heading =
      element.querySelector('h1, h2, h3, [data-slide-title]')?.textContent?.trim() ?? ''
    const commentMatch = element.outerHTML.match(/<!--\s*slide:\s*([^>]+?)\s*-->/i)
    const commentTitle = commentMatch?.[1]?.trim() ?? ''
    const title = heading || commentTitle || `Slide ${index + 1}`
    const preview = element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? ''

    return { index, title, preview }
  })
}

export function summarizeDeckHtml(html: string) {
  if (!html.trim()) {
    return 'No deck loaded yet.'
  }

  const slides = listDeckSlides(html)
  const title = extractDeckTitle(html)
  const lineCount = html.split('\n').length

  if (slides.length === 0) {
    return `Deck "${title}" (${lineCount} lines). Slide markers were not detected — use read_deck to inspect structure.`
  }

  const slideList = slides
    .map((slide) => `${slide.index}: ${slide.title}`)
    .join('; ')

  return `Deck "${title}" with ${slides.length} slide(s): ${slideList}. Full HTML is ${lineCount} lines — use read_deck to inspect sections.`
}

export function readDeckHtmlSlice(
  html: string,
  options: { offset?: number; limit?: number } = {},
): ReadDeckSlice {
  const lines = html.split('\n')
  const totalLines = lines.length
  const offset = Math.max(1, options.offset ?? 1)
  const limit = Math.max(1, options.limit ?? DEFAULT_READ_MAX_LINES)
  const startIndex = offset - 1
  const selected = lines.slice(startIndex, startIndex + limit)
  let content = selected.join('\n')
  let truncated = startIndex + selected.length < totalLines

  if (Buffer.byteLength(content, 'utf8') > DEFAULT_READ_MAX_BYTES) {
    while (
      content.length > 0 &&
      Buffer.byteLength(content, 'utf8') > DEFAULT_READ_MAX_BYTES
    ) {
      content = content.slice(0, Math.floor(content.length * 0.9))
    }

    truncated = true
  }

  const nextOffset = startIndex + content.split('\n').length + 1
  const hint =
    truncated && nextOffset <= totalLines
      ? `Output truncated. Call read_deck again with offset=${nextOffset} to continue.`
      : undefined

  return {
    content,
    totalLines,
    offset,
    limit,
    truncated,
    hint,
  }
}

export function readDeckSlideHtml(html: string, slideIndex: number) {
  const doc = new JSDOM(html).window.document
  const slideElements = findSlideElements(doc)
  const slide = slideElements[slideIndex]

  if (!slide) {
    return {
      ok: false as const,
      error: `Slide index ${slideIndex} is out of range. Deck has ${slideElements.length} slide(s).`,
    }
  }

  return {
    ok: true as const,
    index: slideIndex,
    title:
      slide.querySelector('h1, h2, h3')?.textContent?.trim() ||
      `Slide ${slideIndex + 1}`,
    content: slide.outerHTML,
  }
}
