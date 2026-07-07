/**
 * Reveal.js slide indexing for Ark.
 *
 * Ark uses a flattened linear slide index that matches Reveal's internal slide
 * order: each horizontal slide without nested sections counts as one slide; a
 * horizontal slide with vertical child sections expands into one index per child.
 * Fragment steps are not included in Ark indexes.
 */

export type RevealSlideIndices = {
  h: number
  v: number
}

function clampLinearIndex(index: number, slideCount: number) {
  if (!Number.isFinite(index) || slideCount <= 0) {
    return 0
  }

  return Math.max(0, Math.min(slideCount - 1, Math.floor(index)))
}

export function findRevealSlidesContainer(root: ParentNode) {
  return root.querySelector('.reveal .slides')
}

export function hasRevealSlideStructure(root: ParentNode) {
  return Boolean(findRevealSlidesContainer(root))
}

export function flattenRevealSlideElements(slidesContainer: ParentNode) {
  const horizontalSections = [...slidesContainer.querySelectorAll(':scope > section')]

  if (horizontalSections.length === 0) {
    return []
  }

  const flattened: Element[] = []

  for (const horizontal of horizontalSections) {
    const verticalSections = [...horizontal.querySelectorAll(':scope > section')]

    if (verticalSections.length > 0) {
      flattened.push(...verticalSections)
      continue
    }

    flattened.push(horizontal)
  }

  return flattened
}

export function flattenRevealSlideElementsFromRoot(root: ParentNode) {
  const slidesContainer = findRevealSlidesContainer(root)

  if (!slidesContainer) {
    return []
  }

  return flattenRevealSlideElements(slidesContainer)
}

export function revealSlideCountFromRoot(root: ParentNode) {
  return flattenRevealSlideElementsFromRoot(root).length
}

export function revealLinearIndexToHV(
  slidesContainer: ParentNode,
  linearIndex: number,
): RevealSlideIndices | null {
  const slides = flattenRevealSlideElements(slidesContainer)

  if (slides.length === 0) {
    return null
  }

  const targetSlide = slides[clampLinearIndex(linearIndex, slides.length)]
  const horizontalSections = [...slidesContainer.querySelectorAll(':scope > section')]

  for (let h = 0; h < horizontalSections.length; h++) {
    const horizontal = horizontalSections[h]
    const verticalSections = [...horizontal.querySelectorAll(':scope > section')]

    if (verticalSections.length > 0) {
      const v = verticalSections.indexOf(targetSlide)

      if (v >= 0) {
        return { h, v }
      }

      continue
    }

    if (horizontal === targetSlide) {
      return { h, v: 0 }
    }
  }

  return null
}

export function revealSlideToLinearIndex(slidesContainer: ParentNode, slide: Element) {
  return flattenRevealSlideElements(slidesContainer).indexOf(slide)
}

export function revealHVToLinearIndex(slidesContainer: ParentNode, indices: RevealSlideIndices) {
  const slides = flattenRevealSlideElements(slidesContainer)
  const horizontalSections = [...slidesContainer.querySelectorAll(':scope > section')]
  const horizontal = horizontalSections[indices.h]

  if (!horizontal) {
    return null
  }

  const verticalSections = [...horizontal.querySelectorAll(':scope > section')]
  const targetSlide =
    verticalSections.length > 0 ? verticalSections[indices.v] : indices.v === 0 ? horizontal : null

  if (!targetSlide) {
    return null
  }

  const linearIndex = slides.indexOf(targetSlide)

  return linearIndex >= 0 ? linearIndex : null
}
