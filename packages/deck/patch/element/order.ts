import {
  ARK_ELEMENT_ID_ATTR,
  ARK_MANAGED_ATTR,
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck/document/metadata.ts'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import { stampEditableElementIds } from '../editable-elements.ts'
import { ensureStableElementId } from './ids.ts'
import { formatPixelValue } from './layout.ts'
import { resolveElementTarget } from './resolve.ts'
import {
  isAbsolutelyPositioned,
  mergeInlineStyle,
  parsePixelValueFromStyle,
  readInlineStyleValue,
} from './style.ts'
import type { ElementPatchContext } from './types.ts'
import { markElementChanged } from './types.ts'
import { assertElementPatchable } from './validate.ts'

export function applyDeleteElement(
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

export function applyDuplicateElement(
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

export function applyReorderElement(
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
