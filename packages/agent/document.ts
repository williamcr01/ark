import {
  summarizeParsedDeck,
  toDeckSlideSummaries,
  type DeckParseResult,
} from '@ark/deck/document/parser.ts'
import { parseDeckHtml, type DeckParseOptions } from '@ark/deck-node/document/parser.ts'

export { syncDeckHtmlTitle } from '@ark/deck/document/title.ts'

export const DEFAULT_READ_MAX_LINES = 2000
export const DEFAULT_READ_MAX_BYTES = 50 * 1024

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
  shownLineStart: number
  shownLineEnd: number
  nextOffset?: number
  charOffset?: number
  nextCharOffset?: number
  hint?: string
}

const utf8Prefix = (value: string, maxBytes: number, characterOffset = 0) => {
  const characters = [...value]
  let content = ''
  let used = 0
  let index = characterOffset
  while (index < characters.length) {
    const characterBytes = Buffer.byteLength(characters[index], 'utf8')
    if (used + characterBytes > maxBytes) break
    content += characters[index]
    used += characterBytes
    index += 1
  }
  return { content, nextCharacterOffset: index, totalCharacters: characters.length }
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
  const selected: string[] = []
  let selectedBytes = 0
  for (const line of lines.slice(startIndex, startIndex + limit)) {
    const lineBytes = Buffer.byteLength(line, 'utf8') + (selected.length ? 1 : 0)
    if (selectedBytes + lineBytes > DEFAULT_READ_MAX_BYTES) break
    selected.push(line)
    selectedBytes += lineBytes
  }
  let content = selected.join('\n')
  let nextCharOffset: number | undefined
  if (!selected.length && startIndex < totalLines) {
    const page = utf8Prefix(lines[startIndex], DEFAULT_READ_MAX_BYTES)
    content = page.content
    nextCharOffset = page.nextCharacterOffset
  }
  const shownLineEnd = startIndex + Math.max(selected.length, content ? 1 : 0)
  const nextOffset = selected.length ? startIndex + selected.length + 1 : undefined
  const truncated = shownLineEnd < totalLines || nextCharOffset !== undefined
  const hint =
    nextCharOffset !== undefined
      ? `Line ${offset} exceeds 50KB. Call read_deck({ offset: ${offset}, charOffset: ${nextCharOffset} }) to continue it.`
      : truncated && nextOffset && nextOffset <= totalLines
        ? `Output truncated. Call read_deck({ offset: ${nextOffset} }) to continue.`
        : undefined

  return {
    content,
    totalLines,
    offset,
    limit,
    truncated,
    shownLineStart: offset,
    shownLineEnd,
    ...(nextOffset ? { nextOffset } : {}),
    ...(nextCharOffset !== undefined ? { nextCharOffset } : {}),
    hint,
  }
}

export function readDeckCharacterSlice(
  html: string,
  options: { offset?: number; charOffset?: number; charLimitBytes?: number },
): ReadDeckSlice {
  const lines = html.split('\n')
  const offset = Math.max(1, options.offset ?? 1)
  const line = lines[offset - 1] ?? ''
  const charOffset = Math.max(0, options.charOffset ?? 0)
  const page = utf8Prefix(line, options.charLimitBytes ?? DEFAULT_READ_MAX_BYTES, charOffset)
  const truncated = page.nextCharacterOffset < page.totalCharacters
  return {
    content: page.content,
    totalLines: lines.length,
    offset,
    limit: 1,
    truncated,
    shownLineStart: offset,
    shownLineEnd: offset,
    charOffset,
    ...(truncated ? { nextCharOffset: page.nextCharacterOffset } : { nextOffset: offset + 1 }),
    hint: truncated
      ? `Call read_deck({ offset: ${offset}, charOffset: ${page.nextCharacterOffset} }) to continue this line.`
      : offset < lines.length
        ? `Call read_deck({ offset: ${offset + 1} }) to continue with the next line.`
        : undefined,
  }
}

export function readDeckSlideHtml(html: string, slideIndex: number, charOffset = 0) {
  const parsed = parseDeckHtml(html)
  const slide = parsed.slides[slideIndex]

  if (!slide) {
    return {
      ok: false as const,
      error: `Slide index ${slideIndex} is out of range. Deck has ${parsed.slideCount} slide(s).`,
    }
  }

  const page = utf8Prefix(slide.outerHTML, DEFAULT_READ_MAX_BYTES, charOffset)
  const truncated = page.nextCharacterOffset < page.totalCharacters
  return {
    ok: true as const,
    index: slideIndex,
    title: slide.title,
    content: page.content,
    notes: slide.notes,
    truncated,
    charOffset,
    ...(truncated ? { nextCharOffset: page.nextCharacterOffset } : {}),
    ...(truncated
      ? {
          hint: `Call read_deck({ slideIndex: ${slideIndex}, charOffset: ${page.nextCharacterOffset} }) to continue this slide.`,
        }
      : {}),
  }
}

export function parseDeckStructure(html: string, options?: DeckParseOptions): DeckParseResult {
  return parseDeckHtml(html, options)
}
