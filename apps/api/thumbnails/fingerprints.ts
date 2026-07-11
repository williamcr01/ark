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
  crossSlideInfluenceHash: string
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown) {
  return JSON.stringify(value)
}

const SLIDE_INFLUENCE_ATTRS = ['class', 'id', 'style'] as const

/**
 * Shared chrome with slides removed, plus a separate hash of per-slide material
 * that can affect other slides' screenshots (classes for `:has()`, embedded
 * `<style>`/`<link>`, etc.). Full slide body text stays out of the influence
 * hash so a one-slide copy edit still reuses unchanged slide blobs.
 */
function buildSharedDeckState(html: string) {
  const dom = new JSDOM(html)
  const { document } = dom.window

  try {
    const influences: string[] = []

    findSlideElements(document).forEach((slide, index) => {
      const attrs = SLIDE_INFLUENCE_ATTRS.map((name) => {
        const value = slide.getAttribute(name)
        return value ? `${name}=${value}` : ''
      })
        .filter(Boolean)
        .join('\0')
      const styles = [...slide.querySelectorAll('style, link')]
        .map((node) => node.outerHTML)
        .join('')
      influences.push(`${index}:${attrs}:${styles}`)
      slide.replaceWith(document.createComment(`ark-thumbnail-slide-${index}`))
    })

    return {
      sharedState: document.documentElement.outerHTML,
      crossSlideInfluenceHash: sha256(influences.join('\n')),
    }
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
  const { sharedState, crossSlideInfluenceHash } = buildSharedDeckState(html)
  const sharedStateHash = sha256(sharedState)
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
    crossSlideInfluenceHash,
    customJsFullDeckHash: customJsSalt,
  }

  return {
    parsed,
    fullDeckHash,
    sharedStateHash,
    crossSlideInfluenceHash,
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
