import type { SlideContext } from '@ark/deck-core/chat.ts'

const MAX_TITLE_LENGTH = 200

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

/** Drop indexes that are out of range for the current deck. */
export function filterValidSlideIndexes(indexes: number[], slideCount: number): number[] {
  if (slideCount <= 0) {
    return []
  }

  return indexes.filter((slideIndex) => slideIndex >= 0 && slideIndex < slideCount)
}

/** Build slide context entries for a generation request from selected indexes. */
export function buildSlideContexts(
  indexes: number[],
  slides: { index: number; outerHTML: string }[],
): SlideContext[] {
  return indexes
    .slice()
    .sort((left, right) => left - right)
    .flatMap((slideIndex) => {
      const slide = slides.find((entry) => entry.index === slideIndex)
      if (!slide) {
        return []
      }

      const title = extractSlideTitleFromOuterHtml(slide.outerHTML, slideIndex)
      const slideId = extractSlideIdFromOuterHtml(slide.outerHTML)

      return [
        {
          slideIndex,
          ...(slideId ? { slideId } : {}),
          ...(title ? { title } : {}),
        },
      ]
    })
}
