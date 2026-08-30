import {
  flattenRevealSlideElementsFromRoot,
  hasRevealSlideStructure,
} from './reveal-slide-index.ts'

export const SLIDE_SELECTOR_CHAIN = [
  'section.slide',
  'body > section',
  '.slides > section',
  '.reveal .slides > section',
  'main > section',
] as const

export function findSlideElements(root: ParentNode) {
  if (hasRevealSlideStructure(root)) {
    const revealSlides = flattenRevealSlideElementsFromRoot(root)

    if (revealSlides.length > 0) {
      return revealSlides
    }
  }

  for (const selector of SLIDE_SELECTOR_CHAIN) {
    const slides = [...root.querySelectorAll(selector)]

    if (slides.length > 0) {
      return slides
    }
  }

  return []
}
