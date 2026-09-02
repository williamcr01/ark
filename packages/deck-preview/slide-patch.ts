/**
 * Slide-level preview patching.
 *
 * When the agent (or any deck edit) changes only slide markup, the shell can
 * swap the affected slides inside the already-loaded preview instead of
 * rebuilding a preview session and reloading the iframe. That keeps the active
 * slide, avoids the reload flash, and leaves untouched slides alone.
 *
 * Patching is deliberately conservative: anything that changes the document
 * outside the slide list (styles, head, deck scripts, the slide container) or
 * any deck that keeps its own scripts falls back to a full reload.
 */

import {
  detectRuntimeModeFromDocument,
  documentAllowsDeckInitScripts,
  runtimeModeAllowsDeckScripts,
} from '@ark/runtime-registry/deck-runtime.ts'
import type { DeckSlidePatchOperation } from './protocol/index.ts'
import { absolutizePreviewAssetReferences, stripPreviewScriptsAndHandlers } from './preview-html.ts'
import { findSlideElements } from '@ark/deck/document/slides.ts'
import { stripHostileNavigationVectors } from '@ark/deck/document/sanitize.ts'

/** Placeholder element left where the slide list was, so skeletons stay count-independent. */
const SLIDE_SLOT_TAG = 'ark-slide-slot'

/** Above this the LCS diff is not worth it; a reload is cheaper than the edit script. */
const MAX_DIFFED_SLIDES = 200

/** Guards against pushing an unreasonable payload through postMessage. */
const MAX_PATCH_HTML_LENGTH = 2_000_000

export type DeckSlideSnapshot = {
  /**
   * The preview document with the whole slide list replaced by a single marker.
   * Equal skeletons mean every difference between two decks is inside slides.
   */
  skeleton: string
  /** Preview-ready HTML per slide, in slide order. */
  slides: string[]
}

export type DeckSlidePatch = {
  operations: DeckSlidePatchOperation[]
  /** Expected slide count after the patch; the shell verifies it against the runtime. */
  slideCount: number
  /**
   * For each previous slide index, the index of the same (byte-identical) slide
   * in the next deck, or `-1` when that slide was removed or replaced. The shell
   * uses this to keep the viewer on the slide they were watching across inserts
   * and deletes before the active position.
   */
  slideIndexMap: number[]
}

export type DeckSlideSnapshotOptions = {
  /** App origin used to absolutize `/api/...` asset URLs, matching the preview pipeline. */
  assetOrigin?: string | null
}

function clampSlideIndex(index: number, slideCount: number) {
  if (!Number.isFinite(index) || slideCount <= 0) {
    return 0
  }

  return Math.max(0, Math.min(slideCount - 1, Math.floor(index)))
}

/**
 * Build a comparable snapshot of a deck's preview slides, or `null` when the
 * deck cannot be patched in place.
 */
export function createDeckSlideSnapshot(
  html: string,
  options: DeckSlideSnapshotOptions = {},
): DeckSlideSnapshot | null {
  if (!html.trim()) {
    return null
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  if (!doc.documentElement) {
    return null
  }

  const mode = detectRuntimeModeFromDocument(doc)

  // Decks that keep their own scripts own navigation and re-run init on load;
  // replayed markup would neither execute nor re-bind. Reload those instead.
  if (runtimeModeAllowsDeckScripts(mode) || documentAllowsDeckInitScripts(doc)) {
    return null
  }

  stripHostileNavigationVectors(doc.documentElement)
  stripPreviewScriptsAndHandlers(doc.documentElement, {
    preserveApprovedRuntimeScripts: mode === 'reveal',
  })
  absolutizePreviewAssetReferences(doc.documentElement, options.assetOrigin)

  const slides = findSlideElements(doc)
  const parent = slides[0]?.parentNode

  // A single shared parent keeps the runtime's insert/remove positions exact.
  // Nested reveal stacks and unusual layouts fall back to a reload.
  if (!parent || slides.some((slide) => slide.parentNode !== parent)) {
    return null
  }

  const slideHtml = slides.map((slide) => slide.outerHTML)

  parent.insertBefore(doc.createElement(SLIDE_SLOT_TAG), slides[0]!)

  for (const slide of slides) {
    slide.remove()
  }

  return { skeleton: doc.documentElement.outerHTML, slides: slideHtml }
}

/**
 * Diff two snapshots into a slide edit script, or `null` when the change cannot
 * be expressed as slide swaps and the preview must reload.
 */
export function diffDeckSlideSnapshots(
  previous: DeckSlideSnapshot,
  next: DeckSlideSnapshot,
): DeckSlidePatch | null {
  if (previous.skeleton !== next.skeleton) {
    return null
  }

  if (next.slides.length === 0) {
    return null
  }

  if (previous.slides.length > MAX_DIFFED_SLIDES || next.slides.length > MAX_DIFFED_SLIDES) {
    return null
  }

  const lcs = buildSlideLcs(previous.slides, next.slides)
  const operations = buildSlideEditScript(previous.slides, next.slides, lcs)
  const patchLength = operations.reduce(
    (total, operation) => total + (operation.op === 'insert' ? operation.html.length : 0),
    0,
  )

  if (patchLength > MAX_PATCH_HTML_LENGTH) {
    return null
  }

  return {
    operations,
    slideCount: next.slides.length,
    slideIndexMap: buildSlideIndexMap(previous.slides, next.slides, lcs),
  }
}

/**
 * Map an active slide index across two slide lists using LCS identity.
 *
 * Surviving identical slides keep the viewer on that content. When the active
 * slide was removed or replaced, fall back to the same numeric position
 * (clamped) in the new deck.
 */
export function mapPreservedSlideIndex(
  previous: readonly string[],
  next: readonly string[],
  activeIndex: number,
): number {
  if (next.length === 0) {
    return 0
  }

  const clampedActive = clampSlideIndex(activeIndex, Math.max(previous.length, 1))

  if (previous.length === 0) {
    return clampSlideIndex(activeIndex, next.length)
  }

  if (
    previous.length > MAX_DIFFED_SLIDES ||
    next.length > MAX_DIFFED_SLIDES ||
    clampedActive >= previous.length
  ) {
    return clampSlideIndex(activeIndex, next.length)
  }

  const mapped = buildSlideIndexMap(previous, next)[clampedActive]

  if (typeof mapped === 'number' && mapped >= 0) {
    return mapped
  }

  return clampSlideIndex(activeIndex, next.length)
}

/**
 * Resolve the slide the viewer should keep across a full HTML replacement.
 * Falls back to positional clamping when either side cannot be snapshotted.
 */
export function mapPreservedSlideIndexFromHtml(
  previousHtml: string,
  nextHtml: string,
  activeIndex: number,
  fallbackSlideCount: number,
  options: DeckSlideSnapshotOptions = {},
): number {
  const previous = createDeckSlideSnapshot(previousHtml, options)
  const next = createDeckSlideSnapshot(nextHtml, options)

  if (!previous || !next) {
    return clampSlideIndex(activeIndex, fallbackSlideCount)
  }

  return mapPreservedSlideIndex(previous.slides, next.slides, activeIndex)
}

/** Resolve which slide to show after a live patch lands. */
export function resolvePatchActiveSlideIndex(patch: DeckSlidePatch, activeIndex: number): number {
  const mapped = patch.slideIndexMap[activeIndex]

  if (typeof mapped === 'number' && mapped >= 0) {
    return mapped
  }

  return clampSlideIndex(activeIndex, patch.slideCount)
}

type SlideLcs = number[][]

function buildSlideLcs(previous: readonly string[], next: readonly string[]): SlideLcs {
  const rows = previous.length
  const cols = next.length
  // lengths[i][j] = LCS length of previous[i..] and next[j..]
  const lengths = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lengths[i]![j] =
        previous[i] === next[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!)
    }
  }

  return lengths
}

/**
 * For each previous index, the matching next index when that slide is in the
 * LCS, otherwise `-1`.
 */
function buildSlideIndexMap(
  previous: readonly string[],
  next: readonly string[],
  lcs: SlideLcs = buildSlideLcs(previous, next),
): number[] {
  const mapping = previous.map(() => -1)
  let i = 0
  let j = 0

  while (i < previous.length && j < next.length) {
    if (previous[i] === next[j]) {
      mapping[i] = j
      i += 1
      j += 1
      continue
    }

    if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      i += 1
      continue
    }

    j += 1
  }

  return mapping
}

/**
 * Longest-common-subsequence edit script over slide HTML. Unchanged slides are
 * kept (their DOM is never touched); a changed slide becomes a remove followed
 * by an insert at the same position.
 */
function buildSlideEditScript(
  previous: readonly string[],
  next: readonly string[],
  lcs: SlideLcs = buildSlideLcs(previous, next),
): DeckSlidePatchOperation[] {
  const rows = previous.length
  const cols = next.length
  const operations: DeckSlidePatchOperation[] = []
  let i = 0
  let j = 0
  // Position in the evolving slide list the runtime is mutating.
  let cursor = 0

  while (i < rows && j < cols) {
    if (previous[i] === next[j]) {
      i += 1
      j += 1
      cursor += 1
      continue
    }

    if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      operations.push({ op: 'remove', index: cursor })
      i += 1
      continue
    }

    operations.push({ op: 'insert', index: cursor, html: next[j]! })
    j += 1
    cursor += 1
  }

  while (i < rows) {
    operations.push({ op: 'remove', index: cursor })
    i += 1
  }

  while (j < cols) {
    operations.push({ op: 'insert', index: cursor, html: next[j]! })
    j += 1
    cursor += 1
  }

  return operations
}
