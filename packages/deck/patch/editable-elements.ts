import type { ParsedEditableElement, SlideEditableElements } from '@ark/deck/document/editable.ts'
import { ARK_EDITABLE_ATTR, ARK_ELEMENT_ID_ATTR } from '@ark/deck/document/metadata.ts'
import { classifyElement, createElementId, resolveSlideId } from './editable-element-classify.ts'
import {
  IMAGE_TAGS,
  TEXT_TAGS,
  UNSAFE_TAGS,
  hasDirectText,
  isRuntimeControl,
  isSpeakerNotesElement,
} from './editable-element-style.ts'

export {
  createElementId,
  createTransientSlideId,
  resolveSlideId,
} from './editable-element-classify.ts'

export function parseEditableElement(
  element: Element,
  slide: Element,
  slideIndex: number,
): ParsedEditableElement | null {
  const { slideId } = resolveSlideId(slide, slideIndex)
  return classifyElement(element, slide, slideIndex, slideId)
}

export function parseEditableElementsForSlide(
  slide: Element,
  slideIndex: number,
): SlideEditableElements {
  const { slideId, slideIdTransient } = resolveSlideId(slide, slideIndex)
  const elements: ParsedEditableElement[] = []

  for (const candidate of slide.querySelectorAll('*')) {
    if (!slide.contains(candidate)) {
      continue
    }

    const parsed = classifyElement(candidate, slide, slideIndex, slideId)

    if (parsed) {
      elements.push(parsed)
    }
  }

  return {
    slideIndex,
    slideId,
    slideIdTransient,
    elements,
  }
}

function parseDeckLevelElements(
  doc: Document,
  slideElements: Element[],
): SlideEditableElements | null {
  const body = doc.body

  if (!body) {
    return null
  }

  const slideSet = new Set(slideElements)
  const elements: ParsedEditableElement[] = []

  for (const element of body.querySelectorAll('*')) {
    if (slideSet.has(element) || element.closest('section, .slides > section')) {
      continue
    }

    if (!isRuntimeControl(element, body) && !UNSAFE_TAGS.has(element.tagName.toLowerCase())) {
      continue
    }

    const parsed = classifyElement(element, body, -1, null)

    if (parsed) {
      elements.push(parsed)
    }
  }

  if (elements.length === 0) {
    return null
  }

  return {
    slideIndex: -1,
    slideId: null,
    slideIdTransient: true,
    elements,
  }
}

export function parseEditableElements(
  slideElements: Element[],
  doc?: Document,
): SlideEditableElements[] {
  const grouped = slideElements.map((slide, slideIndex) =>
    parseEditableElementsForSlide(slide, slideIndex),
  )

  if (doc) {
    const deckLevel = parseDeckLevelElements(doc, slideElements)

    if (deckLevel) {
      grouped.push(deckLevel)
    }
  }

  return grouped
}

const STAMP_TAGS = new Set([...TEXT_TAGS, ...IMAGE_TAGS])

export function stampEditableElementIds(root: ParentNode) {
  const stamped: string[] = []

  for (const element of root.querySelectorAll('*')) {
    const tag = element.tagName.toLowerCase()

    if (!STAMP_TAGS.has(tag) && !element.hasAttribute(ARK_ELEMENT_ID_ATTR)) {
      continue
    }

    if (element.hasAttribute(ARK_ELEMENT_ID_ATTR)) {
      continue
    }

    if (UNSAFE_TAGS.has(tag) || isSpeakerNotesElement(element)) {
      continue
    }

    if (TEXT_TAGS.has(tag) && !hasDirectText(element) && element.children.length > 0) {
      continue
    }

    const elementId = createElementId()
    element.setAttribute(ARK_ELEMENT_ID_ATTR, elementId)

    if (!element.hasAttribute(ARK_EDITABLE_ATTR)) {
      element.setAttribute(ARK_EDITABLE_ATTR, 'true')
    }

    stamped.push(elementId)
  }

  return stamped
}
