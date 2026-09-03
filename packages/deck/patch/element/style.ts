import { validateImageSrcForInsert } from '@ark/deck/document/image.ts'
import { isExternalUrl } from '@ark/deck/document/network.ts'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import { ensureStableElementId } from './ids.ts'
import { resolveElementTarget } from './resolve.ts'
import type { ElementPatchContext } from './types.ts'
import { markElementChanged } from './types.ts'
import { assertElementPatchable, isUnsafeAttributeValue, PATCHABLE_ATTRS } from './validate.ts'

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

export function mergeInlineStyle(element: Element, updates: Record<string, string>) {
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

export function readInlineStyleValue(element: Element, property: string) {
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

export function isAbsolutelyPositioned(element: Element) {
  const position = readInlineStyleValue(element, 'position')?.toLowerCase()
  return position === 'absolute' || position === 'fixed'
}

export function parsePixelValueFromStyle(element: Element, property: string) {
  const value = readInlineStyleValue(element, property)

  if (!value) {
    return 0
  }

  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/i)

  return match ? Number.parseFloat(match[1]!) : 0
}

export function applySetAttrs(
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

export function applySetInlineStyle(
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
