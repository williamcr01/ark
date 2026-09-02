import { ARK_ELEMENT_ID_ATTR, ARK_MANAGED_ATTR } from '@ark/deck/document/metadata.ts'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import { stampEditableElementIds } from '../editable-elements.ts'
import { createDeckJsdom } from '../jsdom-inline-style.ts'
import { ensureStableElementId } from './ids.ts'
import { findElementInSlide, resolveSlideTarget } from './resolve.ts'
import type { ElementPatchContext } from './types.ts'
import { markElementChanged } from './types.ts'
import {
  findUnsafeInsertedAttribute,
  findUnsafeInsertedElement,
  validateInsertedImageSources,
} from './validate.ts'

function parseFragmentDocument(html: string): Document {
  return createDeckJsdom(`<!DOCTYPE html><body>${html}</body>`).window.document
}

function importInsertedElement(doc: Document, body: ParentNode) {
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

function parseElementHtml(doc: Document, html: string) {
  const trimmed = html.trim()

  if (!trimmed) {
    return { error: 'Element HTML must not be empty.' } as const
  }

  return importInsertedElement(doc, parseFragmentDocument(trimmed).body)
}

export function applyInsertElement(
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
