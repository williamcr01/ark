import {
  ARK_EDITABLE_ATTR,
  ARK_ELEMENT_ID_ATTR,
  ARK_LOCKED_ATTR,
  ARK_MANAGED_ATTR,
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
  ARK_SPACER_ATTR,
  ARK_SPACER_FOR_ATTR,
  TRANSIENT_ELEMENT_ID_PREFIX,
} from '@ark/deck/document/metadata.ts'
import { validateImageSrcForInsert } from '@ark/deck/document/image.ts'
import { isExternalUrl } from '@ark/deck/document/network.ts'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import {
  createElementId,
  parseEditableElementsForSlide,
  stampEditableElementIds,
} from './editable-elements.ts'
import { createDeckJsdom } from './jsdom-inline-style.ts'

export type ElementPatchContext = {
  doc: Document
  slides: Element[]
  changedSlideIndexes: Set<number>
  changedElementIds: Set<string>
  summaries: string[]
  activeSlideIndex?: number
}

type ResolvedElement = {
  element: Element
  slide: Element
  slideIndex: number
}

type ElementTarget = {
  slideIndex?: number
  slideId?: string
  elementId: string
}

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

const PATCHABLE_ATTRS = new Set([
  'alt',
  'aria-label',
  'class',
  'data-ark-aspect-ratio',
  'data-ark-fit',
  'data-ark-role',
  'data-slide-title',
  'data-title',
  'href',
  'role',
  'src',
  'title',
])

const PATCHABLE_STYLE_PROPS = new Set([
  'background-color',
  'box-sizing',
  'color',
  'display',
  'font-size',
  'font-weight',
  'height',
  'left',
  'line-height',
  'margin',
  'object-fit',
  'opacity',
  'position',
  'text-align',
  'top',
  'visibility',
  'width',
  'z-index',
])

function markElementChanged(context: ElementPatchContext, slideIndex: number, elementId: string) {
  context.changedSlideIndexes.add(slideIndex)
  context.changedElementIds.add(elementId)
}

function formatPixelValue(normalized: number, reference: number) {
  const pixels = Math.round(normalized * reference)
  return `${pixels}px`
}

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

function findElementInSlide(slide: Element, elementId: string, slideIndex: number) {
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

function resolveSlideTarget(
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

function resolveElementTarget(
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

function getEditableElementMeta(slide: Element, slideIndex: number, elementId: string) {
  const group = parseEditableElementsForSlide(slide, slideIndex)
  return group.elements.find((element) => element.id === elementId) ?? null
}

function isUnsafeElement(element: Element) {
  const tag = element.tagName.toLowerCase()

  if (UNSAFE_TAGS.has(tag)) {
    return true
  }

  if (tag === 'aside' && element.classList.contains('notes')) {
    return true
  }

  if (element.getAttribute(ARK_SPACER_ATTR) === 'true') {
    return true
  }

  if (
    element.closest('[data-ark-preview-nav], [data-ark-preview-bridge], [data-ark-preview-reveal]')
  ) {
    return true
  }

  return false
}

function hasInlineAbsolutePosition(element: Element) {
  const style = element.getAttribute('style') ?? ''
  return /(?:^|;)\s*position\s*:\s*absolute\s*(?:;|$)/i.test(style)
}

function insertAdoptSpacer(
  element: Element,
  spacer: NonNullable<Extract<DeckElementPatchOperation, { op: 'move_element' }>['spacer']>,
  elementId: string,
) {
  if (element.getAttribute(ARK_MANAGED_ATTR) === 'true' || hasInlineAbsolutePosition(element)) {
    return
  }

  const previous = element.previousElementSibling

  if (previous?.getAttribute(ARK_SPACER_ATTR) === 'true') {
    const forId = previous.getAttribute(ARK_SPACER_FOR_ATTR)
    if (!forId || forId === elementId || forId === element.getAttribute(ARK_ELEMENT_ID_ATTR)) {
      return
    }
  }

  const parent = element.parentNode

  if (!parent || !element.ownerDocument) {
    return
  }

  const node = element.ownerDocument.createElement('div')
  node.setAttribute(ARK_SPACER_ATTR, 'true')
  node.setAttribute('aria-hidden', 'true')
  node.setAttribute(ARK_SPACER_FOR_ATTR, elementId)
  node.setAttribute(
    'style',
    [
      'visibility: hidden',
      'pointer-events: none',
      'flex: 0 0 auto',
      `display: ${spacer.display}`,
      'box-sizing: border-box',
      `width: ${Math.round(spacer.width)}px`,
      `height: ${Math.round(spacer.height)}px`,
      `margin: ${Math.round(spacer.marginTop)}px ${Math.round(spacer.marginRight)}px ${Math.round(spacer.marginBottom)}px ${Math.round(spacer.marginLeft)}px`,
    ].join('; '),
  )
  parent.insertBefore(node, element)
}

function findUnsafeInsertedElement(root: Element) {
  const elements = [root, ...root.querySelectorAll('*')]

  return elements.find((element) => isUnsafeElement(element)) ?? null
}

function isUnsafeAttributeValue(name: string, value: string) {
  const normalizedName = name.toLowerCase()
  const trimmedValue = value.trim()

  if (normalizedName.startsWith('on')) {
    return true
  }

  if (normalizedName === 'href' || normalizedName === 'src') {
    if (/^(?:javascript|vbscript):/i.test(trimmedValue)) {
      return true
    }

    if (isExternalUrl(trimmedValue)) {
      return true
    }
  }

  return false
}

function findUnsafeInsertedAttribute(root: Element) {
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const name of element.getAttributeNames()) {
      const value = element.getAttribute(name)?.trim() ?? ''

      if (isUnsafeAttributeValue(name, value)) {
        // Image src is validated separately for a clearer error message.
        if (name.toLowerCase() === 'src' && element.tagName.toLowerCase() === 'img') {
          continue
        }

        return name
      }
    }
  }

  return null
}

function validateInsertedImageSources(root: Element) {
  const images = root.tagName.toLowerCase() === 'img' ? [root] : [...root.querySelectorAll('img')]

  for (const image of images) {
    const src = image.getAttribute('src')
    const validation = validateImageSrcForInsert(src)

    if (!validation.ok) {
      return validation.error
    }
  }

  return null
}

function assertElementPatchable(
  resolved: ResolvedElement,
  operation: DeckElementPatchOperation,
  elementId: string,
): { error: string } | null {
  if (isUnsafeElement(resolved.element)) {
    return {
      error: `${operation.op}: target "${resolved.element.tagName.toLowerCase()}" is not editable.`,
    }
  }

  if (operation.op === 'lock_element' || operation.op === 'unlock_element') {
    return null
  }

  const meta = getEditableElementMeta(resolved.slide, resolved.slideIndex, elementId)

  if (!meta) {
    return {
      error: `${operation.op}: element "${elementId}" is not a recognized editable target.`,
    }
  }

  if (meta.locked) {
    return {
      error: `${operation.op}: element "${elementId}" is locked (${meta.lockReason ?? 'locked'}).`,
    }
  }

  return null
}

function ensureStableElementId(element: Element) {
  const existing = element.getAttribute(ARK_ELEMENT_ID_ATTR)?.trim()

  if (existing) {
    return existing
  }

  const elementId = createElementId()
  element.setAttribute(ARK_ELEMENT_ID_ATTR, elementId)

  if (!element.hasAttribute(ARK_EDITABLE_ATTR)) {
    element.setAttribute(ARK_EDITABLE_ATTR, 'true')
  }

  return elementId
}

/**
 * Stamp durable `data-ark-id` values onto every element a batch will touch, then
 * rewrite those ops to the stamped ids. Path-derived transient ids (`transient-el-0-0.1`)
 * become invalid once an earlier op inserts a spacer or deletes a sibling.
 */
export function stabilizeElementPatchOperations(
  context: ElementPatchContext,
  operations: readonly DeckElementPatchOperation[],
): DeckElementPatchOperation[] {
  const rewrittenIds = new Map<string, string>()

  const stabilizeId = (target: ElementTarget, label: string) => {
    const cacheKey = `${target.slideId ?? ''}:${target.slideIndex ?? ''}:${target.elementId}`
    const cached = rewrittenIds.get(cacheKey)

    if (cached) {
      return cached
    }

    const resolved = resolveElementTarget(context, target, label)

    if ('error' in resolved) {
      return target.elementId
    }

    const stableId = ensureStableElementId(resolved.element)
    rewrittenIds.set(cacheKey, stableId)
    return stableId
  }

  return operations.map((operation) => {
    if (operation.op === 'insert_element') {
      if (!operation.afterElementId) {
        return operation
      }

      const afterElementId = stabilizeId(
        {
          slideIndex: operation.slideIndex,
          slideId: operation.slideId,
          elementId: operation.afterElementId,
        },
        'insert_element',
      )

      if (afterElementId === operation.afterElementId) {
        return operation
      }

      return { ...operation, afterElementId }
    }

    if (!('elementId' in operation) || !operation.elementId) {
      return operation
    }

    const elementId = stabilizeId(operation, operation.op)

    if (elementId === operation.elementId) {
      return operation
    }

    return { ...operation, elementId }
  })
}

function parseElementHtml(doc: Document, html: string) {
  const trimmed = html.trim()

  if (!trimmed) {
    return { error: 'Element HTML must not be empty.' } as const
  }

  const fragmentDom = createDeckJsdom(`<!DOCTYPE html><body>${trimmed}</body>`)
  const body = fragmentDom.window.document.body

  if (body.children.length !== 1) {
    return { error: 'insert_element html must contain exactly one root element.' } as const
  }

  const element = doc.importNode(body.firstElementChild!, true) as Element
  const unsafeElement = findUnsafeInsertedElement(element)

  if (unsafeElement) {
    return {
      error: `insert_element cannot insert unsafe <${unsafeElement.tagName.toLowerCase()}> elements.`,
    } as const
  }

  const unsafeAttribute = findUnsafeInsertedAttribute(element)

  if (unsafeAttribute) {
    return {
      error: `insert_element cannot insert unsafe "${unsafeAttribute}" attributes.`,
    } as const
  }

  const imageValidationError = validateInsertedImageSources(element)

  if (imageValidationError) {
    return { error: `insert_element cannot insert image: ${imageValidationError}` } as const
  }

  return { element }
}

function mergeInlineStyle(element: Element, updates: Record<string, string>) {
  const declarations = new Map<string, string>()

  for (const chunk of element.getAttribute('style')?.split(';') ?? []) {
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

  let changed = false

  for (const [property, value] of Object.entries(updates)) {
    const normalizedProperty = property.trim().toLowerCase()

    if (!PATCHABLE_STYLE_PROPS.has(normalizedProperty)) {
      return {
        error: `set_inline_style does not allow the "${property}" property.`,
      } as const
    }

    if (declarations.get(normalizedProperty) !== value) {
      declarations.set(normalizedProperty, value)
      changed = true
    }
  }

  if (!changed) {
    return { error: 'set_inline_style did not change the element.' } as const
  }

  const style = [...declarations.entries()]
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ')

  element.setAttribute('style', style)
  return { ok: true as const }
}

function applyReplaceText(
  context: ElementPatchContext,
  operation: Extract<DeckElementPatchOperation, { op: 'replace_text' }>,
) {
  const resolved = resolveElementTarget(context, operation, 'replace_text')

  if ('error' in resolved) {
    return resolved
  }

  const patchable = assertElementPatchable(resolved, operation, operation.elementId)

  if (patchable) {
    return patchable
  }

  if (resolved.element.textContent === operation.text) {
    return { error: 'replace_text did not change the element.' }
  }

  const elementId = ensureStableElementId(resolved.element)
  resolved.element.textContent = operation.text
  markElementChanged(context, resolved.slideIndex, elementId)
  context.summaries.push(`Replaced text on ${elementId}.`)

  return { ok: true as const }
}

function applyInsertElement(
  context: ElementPatchContext,
  operation: Extract<DeckElementPatchOperation, { op: 'insert_element' }>,
) {
  const slideTarget = resolveSlideTarget(
    context.slides,
    {
      slideIndex:
        operation.slideIndex ?? (operation.slideId ? undefined : context.activeSlideIndex),
      slideId: operation.slideId,
    },
    'insert_element',
  )

  if ('error' in slideTarget) {
    return slideTarget
  }

  const parsed = parseElementHtml(context.doc, operation.html)

  if ('error' in parsed) {
    return parsed
  }

  const rootId = ensureStableElementId(parsed.element)
  const stampedIds = stampEditableElementIds(parsed.element)

  if (!stampedIds.includes(rootId)) {
    stampedIds.unshift(rootId)
  }

  parsed.element.setAttribute(ARK_MANAGED_ATTR, 'true')

  if (!parsed.element.getAttribute('style')?.includes('position')) {
    const style = parsed.element.getAttribute('style')
    const positionStyle = 'position: absolute; left: 48px; top: 120px;'
    parsed.element.setAttribute('style', style ? `${style}; ${positionStyle}` : positionStyle)
  }

  if (operation.afterElementId) {
    const anchor = findElementInSlide(
      slideTarget.element,
      operation.afterElementId,
      slideTarget.index,
    )

    if (!anchor) {
      return {
        error: `insert_element: afterElementId "${operation.afterElementId}" was not found on slide ${slideTarget.index}.`,
      }
    }

    anchor.insertAdjacentElement('afterend', parsed.element)
  } else {
    slideTarget.element.appendChild(parsed.element)
  }

  const elementId = parsed.element.getAttribute(ARK_ELEMENT_ID_ATTR) ?? stampedIds[0]

  if (elementId) {
    markElementChanged(context, slideTarget.index, elementId)
  }

  for (const id of stampedIds) {
    context.changedElementIds.add(id)
  }

  context.summaries.push(`Inserted element on slide ${slideTarget.index}.`)

  return { ok: true as const }
}

function applyDeleteElement(
  context: ElementPatchContext,
  operation: Extract<DeckElementPatchOperation, { op: 'delete_element' }>,
) {
  const resolved = resolveElementTarget(context, operation, 'delete_element')

  if ('error' in resolved) {
    return resolved
  }

  const patchable = assertElementPatchable(resolved, operation, operation.elementId)

  if (patchable) {
    return patchable
  }

  const elementId = operation.elementId
  resolved.element.remove()
  markElementChanged(context, resolved.slideIndex, elementId)
  context.summaries.push(`Deleted ${elementId}.`)

  return { ok: true as const }
}

function clearStableElementIds(root: Element) {
  root.removeAttribute(ARK_ELEMENT_ID_ATTR)

  for (const descendant of root.querySelectorAll(`[${ARK_ELEMENT_ID_ATTR}]`)) {
    descendant.removeAttribute(ARK_ELEMENT_ID_ATTR)
  }
}

function applyDuplicateElement(
  context: ElementPatchContext,
  operation: Extract<DeckElementPatchOperation, { op: 'duplicate_element' }>,
) {
  const resolved = resolveElementTarget(context, operation, 'duplicate_element')

  if ('error' in resolved) {
    return resolved
  }

  const patchable = assertElementPatchable(resolved, operation, operation.elementId)

  if (patchable) {
    return patchable
  }

  const clone = resolved.element.cloneNode(true) as Element
  clearStableElementIds(clone)
  clone.removeAttribute(ARK_MANAGED_ATTR)

  // Only nudge the clone when the source is already absolutely positioned. For a
  // flow-positioned element, forcing `position: absolute` at a small offset would
  // rip the duplicate out of flow to the top-left of the slide; instead let it
  // sit inline right after the original.
  if (isAbsolutelyPositioned(resolved.element)) {
    clone.setAttribute(ARK_MANAGED_ATTR, 'true')
    const offsetX = operation.offsetX ?? 0.02
    const offsetY = operation.offsetY ?? 0.02
    const currentLeft =
      parsePixelValueFromStyle(resolved.element, 'left') / ARK_SLIDE_REFERENCE_WIDTH
    const currentTop =
      parsePixelValueFromStyle(resolved.element, 'top') / ARK_SLIDE_REFERENCE_HEIGHT
    const left = formatPixelValue(Math.min(1, currentLeft + offsetX), ARK_SLIDE_REFERENCE_WIDTH)
    const top = formatPixelValue(Math.min(1, currentTop + offsetY), ARK_SLIDE_REFERENCE_HEIGHT)
    const merged = mergeInlineStyle(clone, {
      position: 'absolute',
      left,
      top,
    })

    if ('error' in merged) {
      return merged
    }
  }

  const rootId = ensureStableElementId(clone)
  const stampedIds = stampEditableElementIds(clone)

  if (!stampedIds.includes(rootId)) {
    stampedIds.unshift(rootId)
  }

  resolved.element.insertAdjacentElement('afterend', clone)

  for (const id of stampedIds) {
    context.changedElementIds.add(id)
    markElementChanged(context, resolved.slideIndex, id)
  }

  context.summaries.push(`Duplicated ${operation.elementId} on slide ${resolved.slideIndex}.`)

  return { ok: true as const }
}

function readInlineStyleValue(element: Element, property: string) {
  const inline = element.getAttribute('style')

  if (!inline) {
    return null
  }

  for (const chunk of inline.split(';')) {
    const separator = chunk.indexOf(':')

    if (separator === -1) {
      continue
    }

    const name = chunk.slice(0, separator).trim().toLowerCase()

    if (name === property) {
      return chunk.slice(separator + 1).trim()
    }
  }

  return null
}

function isAbsolutelyPositioned(element: Element) {
  const position = readInlineStyleValue(element, 'position')?.toLowerCase()
  return position === 'absolute' || position === 'fixed'
}

function parsePixelValueFromStyle(element: Element, property: string) {
  const value = readInlineStyleValue(element, property)

  if (!value) {
    return 0
  }

  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/i)

  return match ? Number.parseFloat(match[1]!) : 0
}

function applySetAttrs(
  context: ElementPatchContext,
  operation: Extract<DeckElementPatchOperation, { op: 'set_attrs' }>,
) {
  const resolved = resolveElementTarget(context, operation, 'set_attrs')

  if ('error' in resolved) {
    return resolved
  }

  const patchable = assertElementPatchable(resolved, operation, operation.elementId)

  if (patchable) {
    return patchable
  }

  let changed = false

  for (const [name, value] of Object.entries(operation.attrs)) {
    if (!PATCHABLE_ATTRS.has(name)) {
      return { error: `set_attrs does not allow the "${name}" attribute.` }
    }

    if (name === 'src' && resolved.element.tagName.toLowerCase() === 'img') {
      const srcValidation = validateImageSrcForInsert(value)

      if (!srcValidation.ok) {
        return { error: `set_attrs cannot set img src: ${srcValidation.error}` }
      }
    } else if (isUnsafeAttributeValue(name, value)) {
      if ((name === 'href' || name === 'src') && isExternalUrl(value)) {
        return { error: `set_attrs does not allow external "${name}" URLs.` }
      }

      return { error: `set_attrs does not allow unsafe "${name}" values.` }
    }

    if (resolved.element.getAttribute(name) !== value) {
      resolved.element.setAttribute(name, value)
      changed = true
    }
  }

  if (!changed) {
    return { error: 'set_attrs did not change the element.' }
  }

  const elementId = ensureStableElementId(resolved.element)
  markElementChanged(context, resolved.slideIndex, elementId)
  context.summaries.push(`Updated attributes on ${elementId}.`)

  return { ok: true as const }
}

function applySetInlineStyle(
  context: ElementPatchContext,
  operation: Extract<DeckElementPatchOperation, { op: 'set_inline_style' }>,
) {
  const resolved = resolveElementTarget(context, operation, 'set_inline_style')

  if ('error' in resolved) {
    return resolved
  }

  const patchable = assertElementPatchable(resolved, operation, operation.elementId)

  if (patchable) {
    return patchable
  }

  if (!(resolved.element instanceof context.doc.defaultView!.HTMLElement)) {
    return { error: 'set_inline_style requires an HTML element target.' }
  }

  const merged = mergeInlineStyle(resolved.element, operation.style)

  if ('error' in merged) {
    return merged
  }

  const elementId = ensureStableElementId(resolved.element)
  markElementChanged(context, resolved.slideIndex, elementId)
  context.summaries.push(`Updated style on ${elementId}.`)

  return { ok: true as const }
}

function applyMoveElement(
  context: ElementPatchContext,
  operation: Extract<DeckElementPatchOperation, { op: 'move_element' }>,
) {
  const resolved = resolveElementTarget(context, operation, 'move_element')

  if ('error' in resolved) {
    return resolved
  }

  const patchable = assertElementPatchable(resolved, operation, operation.elementId)

  if (patchable) {
    return patchable
  }

  const slideWidth = operation.slideWidth ?? ARK_SLIDE_REFERENCE_WIDTH
  const slideHeight = operation.slideHeight ?? ARK_SLIDE_REFERENCE_HEIGHT
  const left = formatPixelValue(operation.cssX ?? operation.x, slideWidth)
  const top = formatPixelValue(operation.cssY ?? operation.y, slideHeight)
  const adopted = operation.width !== undefined || operation.height !== undefined
  // Stamp a stable id before inserting the spacer so data-ark-spacer-for is durable.
  const elementId = ensureStableElementId(resolved.element)

  if (operation.spacer) {
    insertAdoptSpacer(resolved.element, operation.spacer, elementId)
  }

  const style = {
    position: 'absolute',
    left,
    top,
    ...(adopted ? { margin: '0', 'box-sizing': 'border-box' } : {}),
    ...(operation.width === undefined
      ? {}
      : {
          width: formatPixelValue(operation.cssWidth ?? operation.width, slideWidth),
        }),
    ...(operation.height === undefined
      ? {}
      : {
          height: formatPixelValue(operation.cssHeight ?? operation.height, slideHeight),
        }),
  }
  const merged = mergeInlineStyle(resolved.element, style)

  if ('error' in merged) {
    return merged
  }

  resolved.element.setAttribute(ARK_MANAGED_ATTR, 'true')
  markElementChanged(context, resolved.slideIndex, elementId)
  context.summaries.push(`Moved ${elementId}.`)

  return { ok: true as const }
}

function applyResizeElement(
  context: ElementPatchContext,
  operation: Extract<DeckElementPatchOperation, { op: 'resize_element' }>,
) {
  const resolved = resolveElementTarget(context, operation, 'resize_element')

  if ('error' in resolved) {
    return resolved
  }

  const patchable = assertElementPatchable(resolved, operation, operation.elementId)

  if (patchable) {
    return patchable
  }

  const slideWidth = operation.slideWidth ?? ARK_SLIDE_REFERENCE_WIDTH
  const slideHeight = operation.slideHeight ?? ARK_SLIDE_REFERENCE_HEIGHT
  const width = formatPixelValue(operation.cssWidth ?? operation.width, slideWidth)
  const height = formatPixelValue(operation.cssHeight ?? operation.height, slideHeight)
  const merged = mergeInlineStyle(resolved.element, {
    position: 'absolute',
    width,
    height,
  })

  if ('error' in merged) {
    return merged
  }

  resolved.element.setAttribute(ARK_MANAGED_ATTR, 'true')
  const elementId = ensureStableElementId(resolved.element)
  markElementChanged(context, resolved.slideIndex, elementId)
  context.summaries.push(`Resized ${elementId}.`)

  return { ok: true as const }
}

function applyReorderElement(
  context: ElementPatchContext,
  operation: Extract<DeckElementPatchOperation, { op: 'reorder_element' }>,
) {
  const resolved = resolveElementTarget(context, operation, 'reorder_element')

  if ('error' in resolved) {
    return resolved
  }

  const patchable = assertElementPatchable(resolved, operation, operation.elementId)

  if (patchable) {
    return patchable
  }

  const position = context.doc.defaultView?.getComputedStyle(resolved.element).position

  if (!position || position === 'static') {
    return { error: 'reorder_element requires a positioned element target.' }
  }

  const targetZIndex = resolveReorderZIndex(resolved.element, operation)
  const merged = mergeInlineStyle(resolved.element, { 'z-index': String(targetZIndex) })

  if ('error' in merged) {
    return merged
  }

  const elementId = ensureStableElementId(resolved.element)
  markElementChanged(context, resolved.slideIndex, elementId)
  context.summaries.push(`Reordered ${elementId} to z-index ${targetZIndex}.`)

  return { ok: true as const }
}

function siblingZIndexBounds(element: Element) {
  const parent = element.parentElement
  let min = 0
  let max = 0

  if (parent) {
    for (const sibling of parent.children) {
      if (sibling === element) {
        continue
      }

      const raw = readInlineStyleValue(sibling, 'z-index')
      const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
      const z = Number.isFinite(parsed) ? parsed : 0
      min = Math.min(min, z)
      max = Math.max(max, z)
    }
  }

  return { min, max }
}

function resolveReorderZIndex(
  element: Element,
  operation: Extract<DeckElementPatchOperation, { op: 'reorder_element' }>,
) {
  if (operation.zIndex !== undefined) {
    return operation.zIndex
  }

  const { min, max } = siblingZIndexBounds(element)

  // Bump past the extreme sibling so the element reliably lands above/below the
  // whole stack instead of nudging by a fixed ±1 from its own (often `auto`/0)
  // z-index, which never clears siblings sitting at the same level.
  return operation.direction === 'back' ? Math.max(0, min - 1) : max + 1
}

function applyLockElement(
  context: ElementPatchContext,
  operation: Extract<DeckElementPatchOperation, { op: 'lock_element' }>,
) {
  const resolved = resolveElementTarget(context, operation, 'lock_element')

  if ('error' in resolved) {
    return resolved
  }

  if (isUnsafeElement(resolved.element)) {
    return {
      error: `lock_element: target "${resolved.element.tagName.toLowerCase()}" is not editable.`,
    }
  }

  if (resolved.element.getAttribute(ARK_LOCKED_ATTR) === 'true') {
    return { error: 'lock_element did not change the element.' }
  }

  const elementId = ensureStableElementId(resolved.element)
  resolved.element.setAttribute(ARK_LOCKED_ATTR, 'true')
  markElementChanged(context, resolved.slideIndex, elementId)
  context.summaries.push(`Locked ${elementId}.`)

  return { ok: true as const }
}

function applyUnlockElement(
  context: ElementPatchContext,
  operation: Extract<DeckElementPatchOperation, { op: 'unlock_element' }>,
) {
  const resolved = resolveElementTarget(context, operation, 'unlock_element')

  if ('error' in resolved) {
    return resolved
  }

  if (isUnsafeElement(resolved.element)) {
    return {
      error: `unlock_element: target "${resolved.element.tagName.toLowerCase()}" is not editable.`,
    }
  }

  if (resolved.element.getAttribute(ARK_LOCKED_ATTR) !== 'true') {
    return { error: 'unlock_element did not change the element.' }
  }

  const elementId = ensureStableElementId(resolved.element)
  resolved.element.removeAttribute(ARK_LOCKED_ATTR)
  markElementChanged(context, resolved.slideIndex, elementId)
  context.summaries.push(`Unlocked ${elementId}.`)

  return { ok: true as const }
}

export function applyElementPatch(
  context: ElementPatchContext,
  operation: DeckElementPatchOperation,
) {
  switch (operation.op) {
    case 'replace_text':
      return applyReplaceText(context, operation)
    case 'insert_element':
      return applyInsertElement(context, operation)
    case 'delete_element':
      return applyDeleteElement(context, operation)
    case 'duplicate_element':
      return applyDuplicateElement(context, operation)
    case 'set_attrs':
      return applySetAttrs(context, operation)
    case 'set_inline_style':
      return applySetInlineStyle(context, operation)
    case 'move_element':
      return applyMoveElement(context, operation)
    case 'resize_element':
      return applyResizeElement(context, operation)
    case 'reorder_element':
      return applyReorderElement(context, operation)
    case 'lock_element':
      return applyLockElement(context, operation)
    case 'unlock_element':
      return applyUnlockElement(context, operation)
    default:
      return { error: `Unsupported element operation: ${(operation as { op: string }).op}` }
  }
}
