import type {
  EditableElementKind,
  EditableElementLockReason,
  EditableElementRole,
  EditableElementStyle,
  ParsedEditableElement,
} from '@ark/deck/document/editable.ts'
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
} from '@ark/deck/document/metadata.ts'
import { ARK_TEXT_BOX_CLASS } from '@ark/deck/patch/text-box.ts'
import { nanoid } from 'nanoid'
import {
  BLOCK_TEXT_TAGS,
  CONTAINER_TAGS,
  IMAGE_TAGS,
  ROLE_VALUES,
  TEXT_TAGS,
  UNSAFE_TAGS,
  hasDirectText,
  isHiddenByAncestor,
  isRuntimeControl,
  isSpeakerNotesElement,
  normalizeText,
  parseStyle,
  PATCH_ATTRS,
} from './editable-element-style.ts'

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

export function classifyElement(
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
