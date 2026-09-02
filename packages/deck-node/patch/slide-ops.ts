import type { JSDOM } from 'jsdom'

import { findSlideElements } from '@ark/deck/document/slides.ts'
import {
  type DeckPatchOperation,
  type DeckPatchResult,
  isElementPatchOperation,
  isSlidePatchOperation,
  isTextReplacePatchOperation,
  summarizePatchOperation,
} from '@ark/deck/patch/patch-request.ts'
import {
  applyElementPatch,
  stabilizeElementPatchOperations,
} from '@ark/deck/patch/element-patch.ts'
import type { ElementPatchContext, ParseFragment } from '@ark/deck/patch/element/types.ts'
import { applyDeckEdits } from '@ark/deck/patch/text-edit.ts'
import { applySlidePatch } from '@ark/deck/patch/slide-ops.ts'
import type { Logger } from '@ark/telemetry/logger.ts'

import { createDeckJsdom } from './jsdom-inline-style.ts'
import { validateDeckDocumentOnServer, type DeckValidationReport } from '../validate/timed.ts'

export type ApplyDeckPatchesOptions = {
  activeSlideIndex?: number
  logger?: Logger
  cache?: DeckDomCache
}

function serializeDeckHtml(dom: JSDOM) {
  return dom.serialize()
}

function closeJsdomWindow(dom: JSDOM) {
  const maybeClose = (dom.window as unknown as { close?: () => void }).close
  maybeClose?.()
}

export type DeckDomCache = {
  get(html: string): JSDOM | null
  set(html: string, dom: JSDOM): void
  clear(): void
  release(dom: JSDOM): void
}

/**
 * Sequential editor commits send back the HTML we just serialized. Reusing that
 * live JSDOM skips parse5 / symbol-tree on the next apply (issue #291). A miss
 * discards the previous window so a different deck or revision never mutates
 * leftover nodes.
 *
 * A live document is not always identical to a re-parse of its serialization
 * (foster-parented `<tr>`/`<td>`, `<template>` content). Cache-hit results can
 * therefore differ from a cold parse in those corners; that is accepted so the
 * sequential editor path stays on the already-mutated tree.
 */
export function createDeckDomCache(): DeckDomCache {
  let entry: { html: string; dom: JSDOM } | null = null

  const clear = () => {
    if (!entry) {
      return
    }

    closeJsdomWindow(entry.dom)
    entry = null
  }

  return {
    get(html) {
      if (!entry || entry.html !== html) {
        return null
      }

      const { dom } = entry
      entry = null
      return dom
    },
    set(html, dom) {
      if (entry?.dom === dom) {
        entry = { html, dom }
        return
      }

      clear()
      entry = { html, dom }
    },
    clear,
    release(dom) {
      if (entry?.dom === dom) {
        entry = null
      }
    },
  }
}

const defaultDeckDomCache = createDeckDomCache()

export function resetDeckDomCache() {
  defaultDeckDomCache.clear()
}

/** @internal */
export function resetApplyDeckDomCacheForTests() {
  resetDeckDomCache()
}

function parseDeckFragment(html: string): Document {
  return createDeckJsdom(`<!DOCTYPE html><body>${html}</body>`).window.document
}

const parseFragment: ParseFragment = parseDeckFragment

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
  const cache = options.cache ?? defaultDeckDomCache
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

    cache.release(dom)
    closeJsdomWindow(dom)
    dom = null
  }

  const flushDom = () => {
    if (!dom) {
      return
    }

    workingHtml = serializeDeckHtml(dom)
    closeDom()
  }

  const getLiveDom = (): JSDOM | null => dom

  const getDomContext = (): ElementPatchContext => {
    if (!dom) {
      dom = cache.get(workingHtml)

      if (!dom) {
        cache.clear()
        // Skip eager css-tree parse of every inline style; editor ops use attributes.
        dom = createDeckJsdom(workingHtml)
      }
    }

    return {
      doc: dom.window.document,
      slides: findSlideElements(dom.window.document),
      changedSlideIndexes: aggregateChangedSlides,
      changedElementIds: aggregateChangedElements,
      summaries: aggregateSummaries,
      activeSlideIndex,
      parseFragment,
    }
  }

  const elementOperations = operations.filter(isElementPatchOperation)
  const rewrittenElementOperations =
    elementOperations.length > 0
      ? stabilizeElementPatchOperations(getDomContext(), elementOperations)
      : []
  let rewrittenElementIndex = 0
  const preparedOperations = operations.map((operation) => {
    if (!isElementPatchOperation(operation)) {
      return operation
    }

    return rewrittenElementOperations[rewrittenElementIndex++] ?? operation
  })

  for (const [operationIndex, operation] of preparedOperations.entries()) {
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
  const liveDom = getLiveDom()
  if (liveDom) {
    workingHtml = serializeDeckHtml(liveDom)
    validation = validateDeckDocumentOnServer(
      liveDom.window.document,
      workingHtml,
      options.logger ? { logger: options.logger } : undefined,
    )
    cache.set(workingHtml, liveDom)
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
