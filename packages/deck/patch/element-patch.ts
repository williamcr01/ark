import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import { ensureStableElementId } from './element/ids.ts'
import { applyInsertElement } from './element/insert.ts'
import { applyMoveElement, applyResizeElement } from './element/layout.ts'
import { applyLockElement, applyUnlockElement } from './element/lock.ts'
import { applyDeleteElement, applyDuplicateElement, applyReorderElement } from './element/order.ts'
import { resolveElementTarget } from './element/resolve.ts'
import { applySetAttrs, applySetInlineStyle } from './element/style.ts'
import { applyReplaceText } from './element/text.ts'
import type { ElementPatchContext, ElementTarget } from './element/types.ts'

export type { ElementPatchContext } from './element/types.ts'

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
