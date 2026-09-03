import { ARK_SPACER_ATTR } from '@ark/deck/document/metadata.ts'
import { validateImageSrcForInsert } from '@ark/deck/document/image.ts'
import { isExternalUrl } from '@ark/deck/document/network.ts'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import { getEditableElementMeta } from './resolve.ts'
import type { ResolvedElement } from './types.ts'

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

export const PATCHABLE_ATTRS = new Set([
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

export function isUnsafeElement(element: Element) {
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

export function isUnsafeAttributeValue(name: string, value: string) {
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

export function findUnsafeInsertedElement(root: Element) {
  const elements = [root, ...root.querySelectorAll('*')]

  return elements.find((element) => isUnsafeElement(element)) ?? null
}

export function findUnsafeInsertedAttribute(root: Element) {
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

export function validateInsertedImageSources(root: Element) {
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

export function assertElementPatchable(
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

  const meta = getEditableElementMeta(resolved)

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
