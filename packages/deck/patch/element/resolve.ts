import { ARK_ELEMENT_ID_ATTR, TRANSIENT_ELEMENT_ID_PREFIX } from '@ark/deck/document/metadata.ts'
import { parseEditableElement } from '../editable-elements.ts'
import type { ElementPatchContext, ElementTarget, ResolvedElement } from './types.ts'

function findElementByPath(slide: Element, path: string) {
  if (!path) {
    return null
  }

  const parts = path.split('.')

  if (parts.some((part) => !/^\d+$/.test(part))) {
    return null
  }

  const indices = parts.map((part) => Number.parseInt(part, 10))

  if (indices.some((index) => !Number.isFinite(index) || index < 0)) {
    return null
  }

  let current: Element | null = slide

  for (const index of indices) {
    if (!current?.children?.[index]) {
      return null
    }

    current = current.children[index]!
  }

  return current
}

function findElementByStableId(slide: Element, elementId: string) {
  for (const element of slide.querySelectorAll(`[${ARK_ELEMENT_ID_ATTR}]`)) {
    if (element.getAttribute(ARK_ELEMENT_ID_ATTR) === elementId) {
      return element
    }
  }

  return null
}

export function findElementInSlide(slide: Element, elementId: string, slideIndex: number) {
  const byAttr = findElementByStableId(slide, elementId)

  if (byAttr) {
    return byAttr
  }

  if (!elementId.startsWith(TRANSIENT_ELEMENT_ID_PREFIX)) {
    return null
  }

  const suffix = elementId.slice(TRANSIENT_ELEMENT_ID_PREFIX.length)
  const dashIndex = suffix.indexOf('-')

  if (dashIndex === -1) {
    return null
  }

  const slideIndexPart = suffix.slice(0, dashIndex)

  if (!/^\d+$/.test(slideIndexPart)) {
    return null
  }

  const idSlideIndex = Number.parseInt(slideIndexPart, 10)

  if (idSlideIndex !== slideIndex) {
    return null
  }

  return findElementByPath(slide, suffix.slice(dashIndex + 1))
}

export function resolveSlideTarget(
  slides: Element[],
  target: { slideIndex?: number; slideId?: string },
  label: string,
): { element: Element; index: number } | { error: string } {
  if (target.slideId) {
    const index = slides.findIndex(
      (slide) => slide.getAttribute('data-ark-slide-id') === target.slideId,
    )

    if (index === -1) {
      return { error: `${label}: slide id "${target.slideId}" was not found.` }
    }

    return { element: slides[index]!, index }
  }

  if (target.slideIndex !== undefined) {
    const slide = slides[target.slideIndex]

    if (!slide) {
      return {
        error: `${label}: slide index ${target.slideIndex} is out of range. Deck has ${slides.length} slide(s).`,
      }
    }

    return { element: slide, index: target.slideIndex }
  }

  return { error: `${label}: provide slideIndex or slideId.` }
}

export function resolveElementTarget(
  context: ElementPatchContext,
  target: ElementTarget,
  label: string,
): ResolvedElement | { error: string } {
  if (target.slideIndex !== undefined || target.slideId) {
    const resolvedSlide = resolveSlideTarget(context.slides, target, label)

    if ('error' in resolvedSlide) {
      return resolvedSlide
    }

    const element = findElementInSlide(resolvedSlide.element, target.elementId, resolvedSlide.index)

    if (!element) {
      return {
        error: `${label}: element "${target.elementId}" was not found on slide ${resolvedSlide.index}.`,
      }
    }

    return {
      element,
      slide: resolvedSlide.element,
      slideIndex: resolvedSlide.index,
    }
  }

  const matches: ResolvedElement[] = []

  for (const [slideIndex, slide] of context.slides.entries()) {
    const element = findElementInSlide(slide, target.elementId, slideIndex)

    if (element) {
      matches.push({ element, slide, slideIndex })
    }
  }

  if (matches.length === 0) {
    return { error: `${label}: element "${target.elementId}" was not found.` }
  }

  if (matches.length > 1) {
    return {
      error: `${label}: element "${target.elementId}" is ambiguous across ${matches.length} slides. Provide slideIndex or slideId.`,
    }
  }

  return matches[0]!
}

export function getEditableElementMeta(resolved: ResolvedElement) {
  return parseEditableElement(resolved.element, resolved.slide, resolved.slideIndex)
}
