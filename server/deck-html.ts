import {
  parseDeckHtml,
  summarizeParsedDeck,
  toDeckSlideSummaries,
  type DeckParseResult,
} from './deck-parser.ts'

export const DEFAULT_READ_MAX_LINES = 2000
export const DEFAULT_READ_MAX_BYTES = 256 * 1024

export type DeckSlideSummary = {
  index: number
  slideId: string | null
  slideIdTransient: boolean
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
  return toDeckSlideSummaries(parseDeckHtml(html))
}

export function summarizeDeckHtml(html: string) {
  if (!html.trim()) {
    return 'No deck loaded yet.'
  }

  return summarizeParsedDeck(parseDeckHtml(html))
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
    while (content.length > 0 && Buffer.byteLength(content, 'utf8') > DEFAULT_READ_MAX_BYTES) {
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
  const parsed = parseDeckHtml(html)
  const slide = parsed.slides[slideIndex]

  if (!slide) {
    return {
      ok: false as const,
      error: `Slide index ${slideIndex} is out of range. Deck has ${parsed.slideCount} slide(s).`,
    }
  }

  return {
    ok: true as const,
    index: slideIndex,
    title: slide.title,
    content: slide.outerHTML,
    notes: slide.notes,
  }
}

export function parseDeckStructure(html: string): DeckParseResult {
  return parseDeckHtml(html)
}
