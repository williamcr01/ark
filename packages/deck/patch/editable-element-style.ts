import type { EditableElementRole, EditableElementStyle } from '@ark/deck/document/editable.ts'
import {
  ARK_EDITABLE_ATTR,
  ARK_ELEMENT_ID_ATTR,
  ARK_LOCKED_ATTR,
  ARK_MANAGED_ATTR,
  ARK_ROLE_ATTR,
} from '@ark/deck/document/metadata.ts'
export const UNSAFE_TAGS = new Set([
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

export const TEXT_TAGS = new Set([
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

export const BLOCK_TEXT_TAGS = new Set([
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

export const IMAGE_TAGS = new Set(['img', 'svg', 'picture'])

export const CONTAINER_TAGS = new Set([
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

export const ROLE_VALUES = new Set<EditableElementRole>([
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

export const PATCH_ATTRS = [
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

export function normalizeText(value: string | null | undefined, maxLength = 80) {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? ''

  if (!normalized) {
    return null
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

export function parsePixelValue(value: string | null | undefined) {
  if (!value) {
    return undefined
  }

  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i)

  if (!match) {
    return undefined
  }

  return Number.parseFloat(match[1]!)
}

export function parseStyle(element: Element): EditableElementStyle | null {
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

export function hasDirectText(element: Element) {
  for (const child of element.childNodes) {
    if (child.nodeType === child.TEXT_NODE && child.textContent?.trim()) {
      return true
    }
  }

  return false
}

export function isHiddenElement(element: Element) {
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

export function isHiddenByAncestor(element: Element, slide: Element) {
  let current = element.parentElement

  while (current && current !== slide) {
    if (isHiddenElement(current)) {
      return true
    }

    current = current.parentElement
  }

  return isHiddenElement(element)
}

export function isSpeakerNotesElement(element: Element) {
  return element.tagName.toLowerCase() === 'aside' && element.classList.contains('notes')
}

export function isRuntimeControl(element: Element, slide: Element) {
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
