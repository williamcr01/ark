import { MAX_SLIDE_CONTEXTS } from '@ark/contracts'
import type { SlideContext } from '@ark/chat/context.ts'

const MAX_TITLE_LENGTH = 200

export type SlideHtmlEntry = {
  index: number
  outerHTML: string
}

/** Attached-slide state captured at toggle time (index + optional stable id). */
export type ContextSlideEntry = {
  slideIndex: number
  slideId?: string
}

/**
 * Extract a short title from a slide's outerHTML for chat context chips / job
 * payloads. Mirrors the server's extractSlideTitle heuristics lightly.
 */
export function extractSlideTitleFromOuterHtml(outerHTML: string, slideIndex: number): string {
  const doc = new DOMParser().parseFromString(outerHTML, 'text/html')
  const root = doc.body.firstElementChild ?? doc.body
  const heading =
    root
      .querySelector('h1, h2, h3, [data-slide-title]')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim() ?? ''
  const dataTitle = root.getAttribute('data-title')?.trim() ?? ''
  const commentMatch = outerHTML.match(/<!--\s*slide:\s*([^>]+?)\s*-->/i)
  const commentTitle = commentMatch?.[1]?.trim() ?? ''
  const title = heading || dataTitle || commentTitle

  if (!title) {
    return `Slide ${slideIndex + 1}`
  }

  return title.slice(0, MAX_TITLE_LENGTH)
}

export function extractSlideIdFromOuterHtml(outerHTML: string): string | undefined {
  const match = outerHTML.match(/\bdata-ark-slide-id=["']([^"']+)["']/i)
  const slideId = match?.[1]?.trim()
  return slideId || undefined
}

export type ToggleContextSlideResult = {
  entries: ContextSlideEntry[]
  /** True when add was rejected because `max` was already reached. */
  capped: boolean
}

/**
 * Toggle a slide in the attached-context list. Removal always succeeds; adds
 * that would exceed `max` leave the list unchanged and set `capped`.
 */
export function toggleContextSlideEntry(
  current: ContextSlideEntry[],
  slideIndex: number,
  slides: SlideHtmlEntry[],
  max: number = MAX_SLIDE_CONTEXTS,
): ToggleContextSlideResult {
  const existingIndex = current.findIndex((entry) => entry.slideIndex === slideIndex)
  if (existingIndex >= 0) {
    return {
      entries: current.filter((_, index) => index !== existingIndex),
      capped: false,
    }
  }

  if (current.length >= max) {
    return { entries: current, capped: true }
  }

  const slide = slides.find((entry) => entry.index === slideIndex)
  const slideId = slide ? extractSlideIdFromOuterHtml(slide.outerHTML) : undefined
  const next: ContextSlideEntry = {
    slideIndex,
    ...(slideId ? { slideId } : {}),
  }

  return {
    entries: [...current, next].sort((left, right) => left.slideIndex - right.slideIndex),
    capped: false,
  }
}

/**
 * Re-resolve attached slides after deck edits: prefer matching by `slideId`,
 * fall back to index for slides without ids, drop vanished/out-of-range entries.
 */
export function resolveContextSlides(
  entries: ContextSlideEntry[],
  slides: SlideHtmlEntry[],
): ContextSlideEntry[] {
  const byId = new Map<string, SlideHtmlEntry>()
  for (const slide of slides) {
    const slideId = extractSlideIdFromOuterHtml(slide.outerHTML)
    if (slideId) {
      byId.set(slideId, slide)
    }
  }

  const resolved: ContextSlideEntry[] = []
  const seenIndexes = new Set<number>()
  const byIndex = new Map(slides.map((slide) => [slide.index, slide]))

  for (const entry of entries) {
    if (entry.slideId) {
      const match = byId.get(entry.slideId)
      if (!match) {
        continue
      }
      if (seenIndexes.has(match.index)) {
        continue
      }
      seenIndexes.add(match.index)
      resolved.push({ slideIndex: match.index, slideId: entry.slideId })
      continue
    }

    const match = byIndex.get(entry.slideIndex)
    if (!match || seenIndexes.has(match.index)) {
      continue
    }
    seenIndexes.add(match.index)
    const slideId = extractSlideIdFromOuterHtml(match.outerHTML)
    resolved.push({
      slideIndex: match.index,
      ...(slideId ? { slideId } : {}),
    })
  }

  return resolved.sort((left, right) => left.slideIndex - right.slideIndex)
}

/** Build generation-request slideContexts from resolved attached entries. */
export function buildSlideContexts(
  entries: ContextSlideEntry[],
  slides: SlideHtmlEntry[],
): SlideContext[] {
  return resolveContextSlides(entries, slides).flatMap((entry) => {
    const slide = slides.find((item) => item.index === entry.slideIndex)
    if (!slide) {
      return []
    }

    const title = extractSlideTitleFromOuterHtml(slide.outerHTML, entry.slideIndex)
    return [
      {
        slideIndex: entry.slideIndex,
        ...(entry.slideId ? { slideId: entry.slideId } : {}),
        ...(title ? { title } : {}),
      },
    ]
  })
}

/** True when two resolved entry lists are identical (order + ids). */
export function sameContextSlideEntries(
  left: ContextSlideEntry[],
  right: ContextSlideEntry[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.slideIndex === right[index]?.slideIndex && entry.slideId === right[index]?.slideId,
    )
  )
}
