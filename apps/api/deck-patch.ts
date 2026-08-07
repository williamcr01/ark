import { JSDOM } from 'jsdom'
import { nanoid } from 'nanoid'

import { findSlideElements } from '@ark/deck-core/deck-preview-slides.ts'
import { ARK_SLIDE_ID_ATTR } from '@ark/deck-core/deck-metadata.ts'
import {
  type DeckPatchOperation,
  type DeckPatchResult,
  isElementPatchOperation,
  isSlidePatchOperation,
  isTextReplacePatchOperation,
  summarizePatchOperation,
} from '@ark/deck-core/deck-patch.ts'
import type { DeckValidationReport } from '@ark/deck-core/deck-validate.ts'
import { applyDeckEdits } from './deck-edit.ts'
import { applyElementPatch } from './deck-element-patch.ts'
import { stampEditableElementIds } from './deck-editable-elements.ts'
import { validateDeckDocumentOnServer } from './deck-validate.ts'

export type ApplyDeckPatchesOptions = {
  activeSlideIndex?: number
}

type ResolvedSlide = {
  element: Element
  index: number
}

type PatchContext = {
  dom: JSDOM
  doc: Document
  slides: Element[]
  changedSlideIndexes: Set<number>
  changedElementIds: Set<string>
  summaries: string[]
  activeSlideIndex?: number
}

function createSlideId() {
  return `ark-slide-${nanoid(10)}`
}

function serializeDeckHtml(dom: JSDOM) {
  return dom.serialize()
}

function findSlideContainer(doc: Document, slides: Element[]) {
  if (slides[0]?.parentElement) {
    return slides[0].parentElement
  }

  return doc.querySelector('.slides') ?? doc.body
}

function resolveSlideTarget(
  slides: Element[],
  target: { slideIndex?: number; slideId?: string },
  label: string,
): ResolvedSlide | { error: string } {
  if (target.slideId) {
    const index = slides.findIndex(
      (slide) => slide.getAttribute(ARK_SLIDE_ID_ATTR) === target.slideId,
    )

    if (index === -1) {
      return {
        error: `${label}: slide id "${target.slideId}" was not found. Call list_slides or parse_deck to refresh structure.`,
      }
    }

    return { element: slides[index]!, index }
  }

  if (target.slideIndex === undefined) {
    return { error: `${label}: provide slideIndex or slideId.` }
  }

  const slide = slides[target.slideIndex]

  if (!slide) {
    return {
      error: `${label}: slide index ${target.slideIndex} is out of range. Deck has ${slides.length} slide(s).`,
    }
  }

  return { element: slide, index: target.slideIndex }
}

function ensureSlideId(slide: Element, requestedId?: string) {
  const existing = slide.getAttribute(ARK_SLIDE_ID_ATTR)?.trim()

  if (existing) {
    return existing
  }

  const slideId = requestedId?.trim() || createSlideId()
  slide.setAttribute(ARK_SLIDE_ID_ATTR, slideId)
  return slideId
}

function parseSlideHtml(doc: Document, html: string, fallbackClass = 'slide') {
  const trimmed = html.trim()

  if (!trimmed) {
    return { error: 'Slide HTML must not be empty.' } as const
  }

  const fragmentDom = new JSDOM(`<!DOCTYPE html><body>${trimmed}</body>`)
  const body = fragmentDom.window.document.body

  const section = body.querySelector('section')

  if (section && trimmed.startsWith('<section')) {
    return { element: doc.importNode(section, true) as Element }
  }

  const wrapper = doc.createElement('section')
  wrapper.className = fallbackClass
  wrapper.innerHTML = trimmed
  return { element: wrapper }
}

function slideClassName(slides: Element[]) {
  if (slides[0]?.classList.contains('slide')) {
    return 'slide'
  }

  return slides[0]?.className || 'slide'
}

function markSlideChanged(context: PatchContext, index: number) {
  if (index >= 0) {
    context.changedSlideIndexes.add(index)
  }
}

function adjustActiveSlideIndex(
  activeSlideIndex: number | undefined,
  event:
    | { type: 'delete'; index: number; remaining: number }
    | { type: 'insert'; index: number }
    | { type: 'reorder'; from: number; to: number },
) {
  if (activeSlideIndex === undefined) {
    return undefined
  }

  switch (event.type) {
    case 'delete': {
      if (event.remaining === 0) {
        return 0
      }

      if (activeSlideIndex > event.index) {
        return activeSlideIndex - 1
      }

      if (activeSlideIndex === event.index) {
        return Math.min(event.index, event.remaining - 1)
      }

      return activeSlideIndex
    }
    case 'insert':
      return activeSlideIndex >= event.index ? activeSlideIndex + 1 : activeSlideIndex
    case 'reorder': {
      if (activeSlideIndex === event.from) {
        return event.to
      }

      let next = activeSlideIndex

      if (event.from < activeSlideIndex && event.to >= activeSlideIndex) {
        next -= 1
      } else if (event.from > activeSlideIndex && event.to <= activeSlideIndex) {
        next += 1
      }

      return next
    }
    default:
      return activeSlideIndex
  }
}

function refreshSlides(context: PatchContext) {
  context.slides = findSlideElements(context.doc)
}

function applyAddSlide(
  context: PatchContext,
  operation: Extract<DeckPatchOperation, { op: 'add_slide' }>,
) {
  const container = findSlideContainer(context.doc, context.slides)

  if (!container) {
    return { error: 'Could not find a slide container in the deck.' }
  }

  const parsed = parseSlideHtml(context.doc, operation.html, slideClassName(context.slides))

  if ('error' in parsed) {
    return parsed
  }

  const slideId = ensureSlideId(parsed.element, operation.slideId)
  const stampedElementIds = stampEditableElementIds(parsed.element)
  const insertIndex =
    operation.afterIndex === undefined || operation.afterIndex < 0
      ? context.slides.length
      : operation.afterIndex + 1

  if (insertIndex > context.slides.length) {
    return {
      error: `add_slide afterIndex ${operation.afterIndex} is out of range for ${context.slides.length} slide(s).`,
    }
  }

  const reference = context.slides[insertIndex]

  if (reference) {
    container.insertBefore(parsed.element, reference)
  } else {
    container.appendChild(parsed.element)
  }

  refreshSlides(context)
  markSlideChanged(context, insertIndex)
  for (const elementId of stampedElementIds) {
    context.changedElementIds.add(elementId)
  }
  context.summaries.push(`Added slide ${slideId} at index ${insertIndex}.`)
  context.activeSlideIndex = adjustActiveSlideIndex(context.activeSlideIndex, {
    type: 'insert',
    index: insertIndex,
  })

  return { ok: true as const }
}

function applyDeleteSlide(
  context: PatchContext,
  operation: Extract<DeckPatchOperation, { op: 'delete_slide' }>,
) {
  const resolved = resolveSlideTarget(context.slides, operation, 'delete_slide')

  if ('error' in resolved) {
    return resolved
  }

  if (context.slides.length <= 1) {
    return { error: 'delete_slide would remove the last slide. Keep at least one slide.' }
  }

  const slideId = resolved.element.getAttribute(ARK_SLIDE_ID_ATTR)
  resolved.element.remove()
  refreshSlides(context)
  markSlideChanged(context, resolved.index)
  context.summaries.push(
    `Deleted slide ${slideId ?? resolved.index} (was index ${resolved.index}).`,
  )
  context.activeSlideIndex = adjustActiveSlideIndex(context.activeSlideIndex, {
    type: 'delete',
    index: resolved.index,
    remaining: context.slides.length,
  })

  return { ok: true as const }
}

function applyReplaceSlide(
  context: PatchContext,
  operation: Extract<DeckPatchOperation, { op: 'replace_slide' }>,
) {
  const resolved = resolveSlideTarget(context.slides, operation, 'replace_slide')

  if ('error' in resolved) {
    return resolved
  }

  const parsed = parseSlideHtml(context.doc, operation.html, slideClassName(context.slides))

  if ('error' in parsed) {
    return parsed
  }

  const previousId = resolved.element.getAttribute(ARK_SLIDE_ID_ATTR)
  if (previousId && !parsed.element.getAttribute(ARK_SLIDE_ID_ATTR)) {
    parsed.element.setAttribute(ARK_SLIDE_ID_ATTR, previousId)
  }

  ensureSlideId(parsed.element)
  const stampedElementIds = stampEditableElementIds(parsed.element)
  resolved.element.replaceWith(parsed.element)
  refreshSlides(context)
  markSlideChanged(context, resolved.index)
  for (const elementId of stampedElementIds) {
    context.changedElementIds.add(elementId)
  }
  context.summaries.push(`Replaced slide at index ${resolved.index}.`)

  return { ok: true as const }
}

function applyReorderSlide(
  context: PatchContext,
  operation: Extract<DeckPatchOperation, { op: 'reorder_slide' }>,
) {
  const resolved = resolveSlideTarget(context.slides, operation, 'reorder_slide')

  if ('error' in resolved) {
    return resolved
  }

  if (operation.toIndex >= context.slides.length) {
    return {
      error: `reorder_slide toIndex ${operation.toIndex} is out of range for ${context.slides.length} slide(s).`,
    }
  }

  if (resolved.index === operation.toIndex) {
    return { error: 'reorder_slide target index matches the current index (no-op).' }
  }

  const container = findSlideContainer(context.doc, context.slides)

  if (!container) {
    return { error: 'Could not find a slide container in the deck.' }
  }

  const slide = resolved.element
  slide.remove()

  refreshSlides(context)

  const destination = context.slides[operation.toIndex]

  if (destination) {
    container.insertBefore(slide, destination)
  } else {
    container.appendChild(slide)
  }

  refreshSlides(context)
  markSlideChanged(context, resolved.index)
  markSlideChanged(context, operation.toIndex)
  context.summaries.push(`Moved slide from index ${resolved.index} to ${operation.toIndex}.`)
  context.activeSlideIndex = adjustActiveSlideIndex(context.activeSlideIndex, {
    type: 'reorder',
    from: resolved.index,
    to: operation.toIndex,
  })

  return { ok: true as const }
}

function applyUpdateSlideTitle(
  context: PatchContext,
  operation: Extract<DeckPatchOperation, { op: 'update_slide_title' }>,
) {
  const resolved = resolveSlideTarget(context.slides, operation, 'update_slide_title')

  if ('error' in resolved) {
    return resolved
  }

  resolved.element.setAttribute('data-title', operation.title)

  const heading = resolved.element.querySelector('h1, h2, h3, [data-slide-title]')

  if (heading) {
    heading.textContent = operation.title
  }

  markSlideChanged(context, resolved.index)
  context.summaries.push(`Updated title on slide ${resolved.index}.`)

  return { ok: true as const }
}

function applyUpdateSlideNotes(
  context: PatchContext,
  operation: Extract<DeckPatchOperation, { op: 'update_slide_notes' }>,
) {
  const resolved = resolveSlideTarget(context.slides, operation, 'update_slide_notes')

  if ('error' in resolved) {
    return resolved
  }

  const notes = operation.notes.trim()
  const aside = resolved.element.querySelector('aside.notes')

  if (aside) {
    aside.textContent = notes
  } else if (notes) {
    resolved.element.setAttribute('data-notes', notes)
  } else {
    resolved.element.removeAttribute('data-notes')
  }

  markSlideChanged(context, resolved.index)
  context.summaries.push(`Updated notes on slide ${resolved.index}.`)

  return { ok: true as const }
}

function applySlidePatch(context: PatchContext, operation: DeckPatchOperation) {
  switch (operation.op) {
    case 'add_slide':
      return applyAddSlide(context, operation)
    case 'delete_slide':
      return applyDeleteSlide(context, operation)
    case 'replace_slide':
      return applyReplaceSlide(context, operation)
    case 'reorder_slide':
      return applyReorderSlide(context, operation)
    case 'update_slide_title':
      return applyUpdateSlideTitle(context, operation)
    case 'update_slide_notes':
      return applyUpdateSlideNotes(context, operation)
    default:
      return { error: `Unsupported slide operation: ${(operation as { op: string }).op}` }
  }
}

/**
 * Apply structured deck patch operations. Slide-level and element-level ops are supported.
 */
export function applyDeckPatches(
  html: string,
  operations: DeckPatchOperation[],
  options: ApplyDeckPatchesOptions = {},
): DeckPatchResult {
  if (!html.trim()) {
    return { ok: false, error: 'No deck HTML is loaded.' }
  }

  if (operations.length === 0) {
    return { ok: false, error: 'At least one patch operation is required.' }
  }

  let workingHtml = html
  const aggregateChangedSlides = new Set<number>()
  const aggregateChangedElements = new Set<string>()
  const aggregateSummaries: string[] = []
  let activeSlideIndex = options.activeSlideIndex
  let appliedCount = 0
  let dom: JSDOM | null = null
  let validation: DeckValidationReport | undefined

  const closeDom = () => {
    if (!dom) {
      return
    }

    // Release the jsdom window when available; ignore environments without close().
    const maybeClose = (dom.window as unknown as { close?: () => void }).close
    maybeClose?.()
    dom = null
  }

  const flushDom = () => {
    if (!dom) {
      return
    }

    workingHtml = serializeDeckHtml(dom)
    closeDom()
  }

  const getDomContext = (): PatchContext => {
    if (!dom) {
      dom = new JSDOM(workingHtml)
    }

    return {
      dom,
      doc: dom.window.document,
      slides: findSlideElements(dom.window.document),
      changedSlideIndexes: aggregateChangedSlides,
      changedElementIds: aggregateChangedElements,
      summaries: aggregateSummaries,
      activeSlideIndex,
    }
  }

  for (const [operationIndex, operation] of operations.entries()) {
    if (isElementPatchOperation(operation)) {
      const context = getDomContext()
      const result = applyElementPatch(context, operation)

      if ('error' in result) {
        flushDom()
        return { ok: false, error: result.error ?? 'Patch operation failed.', operationIndex }
      }

      activeSlideIndex = context.activeSlideIndex
      appliedCount += 1
      continue
    }

    if (isTextReplacePatchOperation(operation)) {
      flushDom()
      const replaced = applyDeckEdits(workingHtml, [
        { oldText: operation.oldText, newText: operation.newText },
      ])

      if (!replaced.ok) {
        return { ok: false, error: replaced.error, operationIndex }
      }

      workingHtml = replaced.html
      appliedCount += 1
      aggregateSummaries.push(summarizePatchOperation(operation))
      continue
    }

    if (!isSlidePatchOperation(operation)) {
      flushDom()
      return {
        ok: false,
        error: `operations[${operationIndex}] is not a recognized patch operation.`,
        operationIndex,
      }
    }

    const context = getDomContext()
    const result = applySlidePatch(context, operation)

    if ('error' in result) {
      flushDom()
      return { ok: false, error: result.error ?? 'Patch operation failed.', operationIndex }
    }

    activeSlideIndex = context.activeSlideIndex
    appliedCount += 1
  }

  // Validate on the live document before serialize so the route/tool path can
  // skip a second full JSDOM parse (issue #287 persistence latency).
  if (dom) {
    workingHtml = serializeDeckHtml(dom)
    validation = validateDeckDocumentOnServer(dom.window.document, workingHtml)
    closeDom()
  } else {
    flushDom()
  }

  if (workingHtml === html) {
    return { ok: false, error: 'Patch operations did not change the deck.' }
  }

  const changedSlideIndexes = [...aggregateChangedSlides].sort((a, b) => a - b)
  const summary = aggregateSummaries.join(' ')

  return {
    ok: true,
    html: workingHtml,
    changedSlideIndexes,
    changedElementIds: [...aggregateChangedElements],
    summary,
    suggestedActiveSlideIndex: activeSlideIndex,
    appliedCount,
    ...(validation ? { validation } : {}),
  }
}

export { createSlideId, ensureSlideId }
