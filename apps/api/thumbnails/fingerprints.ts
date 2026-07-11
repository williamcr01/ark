import { createHash } from 'node:crypto'

import { JSDOM } from 'jsdom'
import { findSlideElements } from '@ark/deck-core/deck-preview-slides.ts'
import { parseDeckHtml, type DeckParseResult } from '../deck-parser.ts'
import {
  THUMBNAIL_OUTPUT_HEIGHT,
  THUMBNAIL_OUTPUT_WIDTH,
  THUMBNAIL_RENDERER_VERSION,
  THUMBNAIL_VIEWPORT_HEIGHT,
  THUMBNAIL_VIEWPORT_WIDTH,
} from './constants.ts'

export type ThumbnailFingerprintResult = {
  parsed: DeckParseResult
  slideFingerprints: string[]
  fullDeckHash: string
  sharedStateHash: string
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown) {
  return JSON.stringify(value)
}

function buildSharedDeckState(html: string) {
  const dom = new JSDOM(html)
  const { document } = dom.window

  try {
    findSlideElements(document).forEach((slide, index) => {
      slide.replaceWith(document.createComment(`ark-thumbnail-slide-${index}`))
    })

    return document.documentElement.outerHTML
  } finally {
    dom.window.close()
  }
}

export function computeThumbnailSlideFingerprints(
  html: string,
  manifestHash: string,
): ThumbnailFingerprintResult {
  const parsed = parseDeckHtml(html)
  const fullDeckHash = sha256(html)
  const sharedStateHash = sha256(buildSharedDeckState(html))
  const customJsSalt = parsed.runtime.previewMode === 'full-js' ? fullDeckHash : null

  const sharedInput = {
    rendererVersion: THUMBNAIL_RENDERER_VERSION,
    manifestHash: manifestHash.trim() || 'none',
    viewport: {
      width: THUMBNAIL_VIEWPORT_WIDTH,
      height: THUMBNAIL_VIEWPORT_HEIGHT,
    },
    output: {
      width: THUMBNAIL_OUTPUT_WIDTH,
      height: THUMBNAIL_OUTPUT_HEIGHT,
    },
    structure: parsed.structure,
    slideSelector: parsed.slideSelector,
    slideCount: parsed.slideCount,
    runtime: parsed.runtime,
    sharedStateHash,
    customJsFullDeckHash: customJsSalt,
  }

  return {
    parsed,
    fullDeckHash,
    sharedStateHash,
    slideFingerprints: parsed.slides.map((slide) =>
      sha256(
        stableJson({
          ...sharedInput,
          slideIndex: slide.index,
          slideHtml: slide.outerHTML,
        }),
      ),
    ),
  }
}
