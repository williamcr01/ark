import { ARK_LOCKED_ATTR } from '@ark/deck/document/metadata.ts'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import { ensureStableElementId } from './ids.ts'
import { resolveElementTarget } from './resolve.ts'
import type { ElementPatchContext } from './types.ts'
import { markElementChanged } from './types.ts'
import { isUnsafeElement } from './validate.ts'

export function applyLockElement(
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

export function applyUnlockElement(
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
