import { nanoid } from 'nanoid'

import type {
  EditableElementKind,
  EditableElementLockReason,
  EditableElementRole,
  EditableElementStyle,
  ParsedEditableElement,
  SlideEditableElements,
} from '@ark/deck-core/deck-editable.ts'
import {
  ARK_EDITABLE_ATTR,
  ARK_ELEMENT_ID_ATTR,
  ARK_LOCKED_ATTR,
  ARK_MANAGED_ATTR,
  ARK_ROLE_ATTR,
  ARK_SLIDE_ID_ATTR,
  ARK_SPACER_ATTR,
  STABLE_ELEMENT_ID_PREFIX,
  TRANSIENT_ELEMENT_ID_PREFIX,
  TRANSIENT_SLIDE_ID_PREFIX,
} from '@ark/deck-core/deck-metadata.ts'
import { ARK_TEXT_BOX_CLASS } from '@ark/deck-core/deck-text-box.ts'

const UNSAFE_TAGS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'template',
  'noscript',
  'iframe',
  'form',
  'input',
  'textarea',
  'select',
  'option',
  'fieldset',
  'legend',
  'object',
  'embed',
])

const TEXT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'button',
  'figcaption',
  'span',
  'a',
  'pre',
  'label',
  'blockquote',
  'cite',
  'td',
  'th',
  'dd',
  'dt',
  'strong',
  'em',
  'small',
  'mark',
  'abbr',
])

const BLOCK_TEXT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'button',
  'figcaption',
  'blockquote',
  'pre',
  'label',
  'td',
  'th',
  'dd',
  'dt',
])

const IMAGE_TAGS = new Set(['img', 'svg', 'picture'])

const CONTAINER_TAGS = new Set([
  'div',
  'section',
  'ul',
  'ol',
  'table',
  'blockquote',
  'pre',
  'figure',
  'a',
  'hr',
])

const RUNTIME_CONTROL_IDS = new Set([
  'prevslide',
  'nextslide',
  'progressbar',
  'currentslide',
  'totalslides',
])

const ROLE_VALUES = new Set<EditableElementRole>([
  'title',
  'subtitle',
  'body',
  'caption',
  'callout',
  'chart-label',
  'decorative',
  'user-inserted',
  'unknown',
])

const PATCH_ATTRS = [
  ARK_ELEMENT_ID_ATTR,
  ARK_EDITABLE_ATTR,
  ARK_ROLE_ATTR,
  ARK_LOCKED_ATTR,
  ARK_MANAGED_ATTR,
  'data-title',
  'data-slide-title',
  'alt',
  'src',
  'href',
  'aria-label',
  'role',
] as const

export function createElementId() {
  return `${STABLE_ELEMENT_ID_PREFIX}${nanoid(10)}`
}

export function createTransientSlideId(slideIndex: number) {
  return `${TRANSIENT_SLIDE_ID_PREFIX}${slideIndex}`
}

export function resolveSlideId(slide: Element, slideIndex: number) {
  const nativeId = slide.getAttribute(ARK_SLIDE_ID_ATTR)?.trim()

  if (nativeId) {
    return { slideId: nativeId, slideIdTransient: false }
  }

  return {
    slideId: createTransientSlideId(slideIndex),
    slideIdTransient: true,
  }
}

function normalizeText(value: string | null | undefined, maxLength = 80) {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? ''

  if (!normalized) {
    return null
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

function parsePixelValue(value: string | null | undefined) {
  if (!value) {
    return undefined
  }

  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i)

  if (!match) {
    return undefined
  }

  return Number.parseFloat(match[1]!)
}

function parseStyle(element: Element): EditableElementStyle | null {
  const inline = element.getAttribute('style')

  if (!inline?.trim()) {
    return null
  }

  const declarations = new Map<string, string>()

  for (const chunk of inline.split(';')) {
    const separator = chunk.indexOf(':')

    if (separator === -1) {
      continue
    }

    const property = chunk.slice(0, separator).trim().toLowerCase()
    const value = chunk.slice(separator + 1).trim()

    if (property && value) {
      declarations.set(property, value)
    }
  }

  const position = declarations.get('position')

  const style: EditableElementStyle = {
    position:
      position === 'absolute' ||
      position === 'relative' ||
      position === 'static' ||
      position === 'fixed' ||
      position === 'sticky'
        ? position
        : undefined,
    left: parsePixelValue(declarations.get('left')),
    top: parsePixelValue(declarations.get('top')),
    width: parsePixelValue(declarations.get('width')),
    height: parsePixelValue(declarations.get('height')),
    zIndex: declarations.has('z-index')
      ? Number.parseInt(declarations.get('z-index') ?? '', 10)
      : undefined,
  }

  return Object.values(style).some((value) => value !== undefined) ? style : null
}

function hasDirectText(element: Element) {
  for (const child of element.childNodes) {
    if (child.nodeType === child.TEXT_NODE && child.textContent?.trim()) {
      return true
    }
  }

  return false
}

function isHiddenElement(element: Element) {
  if (element.hasAttribute('hidden')) {
    return true
  }

  if (element.getAttribute('aria-hidden') === 'true') {
    return true
  }

  const style = element.getAttribute('style')?.toLowerCase() ?? ''

  if (style.includes('display:none') || style.includes('display: none')) {
    return true
  }

  if (style.includes('visibility:hidden') || style.includes('visibility: hidden')) {
    return true
  }

  return false
}

function isHiddenByAncestor(element: Element, slide: Element) {
  let current = element.parentElement

  while (current && current !== slide) {
    if (isHiddenElement(current)) {
      return true
    }

    current = current.parentElement
  }

  return isHiddenElement(element)
}

function isSpeakerNotesElement(element: Element) {
  return element.tagName.toLowerCase() === 'aside' && element.classList.contains('notes')
}

function isRuntimeControl(element: Element, slide: Element) {
  const id = element.id?.trim().toLowerCase()

  if (id && RUNTIME_CONTROL_IDS.has(id)) {
    return true
  }

  if (element.getAttribute('data-ark-preview-nav') !== null) {
    return true
  }

  if (
    element.closest('[data-ark-preview-nav], [data-ark-preview-bridge], [data-ark-preview-reveal]')
  ) {
    return true
  }

  const tag = element.tagName.toLowerCase()

  if (tag === 'button' && !slide.contains(element)) {
    return true
  }

  if (element.getAttribute('data-ark-role') === 'runtime-control') {
    return true
  }

  return false
}

function readRole(element: Element, slide: Element, slideIndex: number): EditableElementRole {
  const explicit = element.getAttribute(ARK_ROLE_ATTR)?.trim().toLowerCase()

  if (explicit && ROLE_VALUES.has(explicit as EditableElementRole)) {
    return explicit as EditableElementRole
  }

  const tag = element.tagName.toLowerCase()

  if (tag === 'h1') {
    return 'title'
  }

  if (tag === 'h2' || tag === 'h3') {
    const firstHeading = slide.querySelector('h1, h2, h3')

    if (firstHeading === element) {
      return slideIndex === 0 && !slide.querySelector('h1') ? 'title' : 'subtitle'
    }

    return 'subtitle'
  }

  if (tag === 'figcaption') {
    return 'caption'
  }

  if (
    tag === 'img' &&
    (element.getAttribute('alt') === '' || element.getAttribute('role') === 'presentation')
  ) {
    return 'decorative'
  }

  if (
    element.getAttribute(ARK_EDITABLE_ATTR) === 'true' ||
    element.hasAttribute(ARK_MANAGED_ATTR)
  ) {
    return 'user-inserted'
  }

  if (BLOCK_TEXT_TAGS.has(tag)) {
    return 'body'
  }

  return 'unknown'
}

function readKind(element: Element): EditableElementKind {
  const explicit = element.getAttribute('data-ark-kind')?.trim().toLowerCase()

  if (explicit === 'text') {
    return 'text'
  }

  if (
    element.getAttribute(ARK_EDITABLE_ATTR) === 'text-box' ||
    element.classList.contains('ark-text-box')
  ) {
    return 'text'
  }

  if (explicit === 'image') {
    return 'image'
  }

  if (explicit === 'shape') {
    return 'shape'
  }

  if (explicit === 'group') {
    return 'group'
  }

  if (explicit === 'runtime-control') {
    return 'runtime-control'
  }

  const tag = element.tagName.toLowerCase()

  if (IMAGE_TAGS.has(tag)) {
    return 'image'
  }

  if (isRuntimeControl(element, element.closest('section') ?? element)) {
    return 'runtime-control'
  }

  if (CONTAINER_TAGS.has(tag)) {
    return 'container'
  }

  if (TEXT_TAGS.has(tag)) {
    return 'text'
  }

  if (element.getAttribute(ARK_ROLE_ATTR) === 'group') {
    return 'group'
  }

  return 'unknown'
}

function isManagedElement(element: Element, style: EditableElementStyle | null) {
  if (element.getAttribute(ARK_MANAGED_ATTR) === 'true') {
    return true
  }

  if (
    element.getAttribute(ARK_EDITABLE_ATTR) === 'true' &&
    element.hasAttribute(ARK_ELEMENT_ID_ATTR)
  ) {
    return true
  }

  return style?.position === 'absolute' && style.left !== undefined && style.top !== undefined
}

function collectPatchAttrs(element: Element) {
  const attrs: Record<string, string> = {}

  for (const name of PATCH_ATTRS) {
    const value = element.getAttribute(name)

    if (value !== null) {
      attrs[name] = value
    }
  }

  return attrs
}

function readClassName(element: Element) {
  return element.getAttribute('class')?.trim() || null
}

function isInsideUnsafeSubtree(element: Element, slide: Element) {
  let current = element.parentElement

  while (current && current !== slide) {
    const tag = current.tagName.toLowerCase()

    if (tag === 'script' || tag === 'style') {
      return true
    }

    current = current.parentElement
  }

  return false
}

function isCandidateElement(element: Element, slide: Element) {
  const tag = element.tagName.toLowerCase()

  if (element === slide) {
    return false
  }

  if (element.getAttribute(ARK_SPACER_ATTR) === 'true') {
    return false
  }

  if (isInsideUnsafeSubtree(element, slide)) {
    return false
  }

  if (element.hasAttribute(ARK_ELEMENT_ID_ATTR)) {
    return true
  }

  if (
    tag === 'div' &&
    (element.getAttribute(ARK_EDITABLE_ATTR) === 'text-box' ||
      element.classList.contains(ARK_TEXT_BOX_CLASS))
  ) {
    return true
  }

  if (isSpeakerNotesElement(element)) {
    return true
  }

  if (UNSAFE_TAGS.has(tag)) {
    return true
  }

  if (IMAGE_TAGS.has(tag)) {
    return true
  }

  if (CONTAINER_TAGS.has(tag)) {
    return true
  }

  if (isRuntimeControl(element, slide)) {
    return true
  }

  if (TEXT_TAGS.has(tag)) {
    if (BLOCK_TEXT_TAGS.has(tag)) {
      return hasDirectText(element) || element.children.length === 0
    }

    return hasDirectText(element)
  }

  return false
}

function hasHigherPriorityDescendant(element: Element, slide: Element) {
  for (const descendant of element.querySelectorAll('*')) {
    if (descendant === element || !slide.contains(descendant)) {
      continue
    }

    if (!isCandidateElement(descendant, slide)) {
      continue
    }

    const descendantTag = descendant.tagName.toLowerCase()
    const tag = element.tagName.toLowerCase()

    if (BLOCK_TEXT_TAGS.has(descendantTag)) {
      return true
    }

    if (tag === 'span' && TEXT_TAGS.has(descendantTag)) {
      return true
    }

    if (descendant.hasAttribute(ARK_ELEMENT_ID_ATTR)) {
      return true
    }
  }

  return false
}

function getElementPath(element: Element, slide: Element) {
  const path: number[] = []
  let current: Element | null = element

  while (current && current !== slide) {
    const parentElement: Element | null = current.parentElement

    if (!parentElement) {
      break
    }

    path.unshift([...parentElement.children].indexOf(current))
    current = parentElement
  }

  return path.join('.')
}

function isManagedWrapper(element: Element) {
  return (
    element.getAttribute(ARK_MANAGED_ATTR) === 'true' ||
    element.getAttribute(ARK_EDITABLE_ATTR) === 'text-box' ||
    element.classList.contains(ARK_TEXT_BOX_CLASS)
  )
}

function classifyElement(
  element: Element,
  slide: Element,
  slideIndex: number,
  slideId: string | null,
): ParsedEditableElement | null {
  if (!isCandidateElement(element, slide)) {
    return null
  }

  // Ark-managed wrappers (text boxes and other managed containers) stay
  // recognized editable targets even though their inner text elements are
  // candidates too — move/resize/style patches address the wrapper (#84).
  if (
    !CONTAINER_TAGS.has(element.tagName.toLowerCase()) &&
    !isManagedWrapper(element) &&
    hasHigherPriorityDescendant(element, slide)
  ) {
    return null
  }

  const tag = element.tagName.toLowerCase()
  const nativeId = element.getAttribute(ARK_ELEMENT_ID_ATTR)?.trim()
  const id =
    nativeId || `${TRANSIENT_ELEMENT_ID_PREFIX}${slideIndex}-${getElementPath(element, slide)}`
  const style = parseStyle(element)
  const kind = readKind(element)
  const role = readRole(element, slide, slideIndex)
  const textPreview =
    kind === 'image'
      ? normalizeText(element.getAttribute('alt') || element.getAttribute('aria-label'))
      : normalizeText(element.textContent)

  let lockReason: EditableElementLockReason | null = null

  if (element.getAttribute(ARK_LOCKED_ATTR) === 'true') {
    lockReason = 'explicit-lock'
  } else if (isSpeakerNotesElement(element)) {
    lockReason = 'speaker-notes'
  } else if (UNSAFE_TAGS.has(tag)) {
    lockReason = 'unsafe-tag'
  } else if (isRuntimeControl(element, slide)) {
    lockReason = 'runtime-control'
  } else if (isHiddenByAncestor(element, slide)) {
    lockReason = 'hidden'
  } else if (kind === 'text' && !textPreview) {
    lockReason = 'no-text-content'
  }

  const managed = isManagedElement(element, style)
  const locked = lockReason !== null

  return {
    id,
    idTransient: !nativeId,
    slideIndex,
    slideId,
    kind,
    role,
    managed,
    locked,
    lockReason,
    textPreview,
    tagName: tag,
    className: readClassName(element),
    attrs: collectPatchAttrs(element),
    style,
  }
}

export function parseEditableElementsForSlide(
  slide: Element,
  slideIndex: number,
): SlideEditableElements {
  const { slideId, slideIdTransient } = resolveSlideId(slide, slideIndex)
  const elements: ParsedEditableElement[] = []

  for (const element of slide.querySelectorAll('*')) {
    if (!slide.contains(element)) {
      continue
    }

    const parsed = classifyElement(element, slide, slideIndex, slideId)

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
