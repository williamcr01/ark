import { ARK_EDITABLE_ATTR, ARK_ELEMENT_ID_ATTR } from '@ark/deck/document/metadata.ts'
import { createElementId } from '../editable-elements.ts'

export function ensureStableElementId(element: Element) {
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
