import {
  ARK_ELEMENT_ID_ATTR,
  ARK_MANAGED_ATTR,
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
  ARK_SPACER_ATTR,
  ARK_SPACER_FOR_ATTR,
} from '@ark/deck/document/metadata.ts'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import { ensureStableElementId } from './ids.ts'
import { resolveElementTarget } from './resolve.ts'
import { mergeInlineStyle } from './style.ts'
import type { ElementPatchContext } from './types.ts'
import { markElementChanged } from './types.ts'
import { assertElementPatchable } from './validate.ts'

export function formatPixelValue(normalized: number, reference: number) {
  const pixels = Math.round(normalized * reference)
  return `${pixels}px`
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

export function applyMoveElement(
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

export function applyResizeElement(
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
