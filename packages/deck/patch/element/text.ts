import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import { ensureStableElementId } from './ids.ts'
import { resolveElementTarget } from './resolve.ts'
import type { ElementPatchContext } from './types.ts'
import { markElementChanged } from './types.ts'
import { assertElementPatchable } from './validate.ts'

export function applyReplaceText(
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
