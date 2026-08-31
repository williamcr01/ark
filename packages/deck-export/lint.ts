/**
 * What a deck loses on the way to PowerPoint.
 *
 * The guiding rule is that the HTML deck is the primary artifact and the export
 * must not degrade it: family choice is constrained up front because that costs
 * nothing, while weights and effects stay unconstrained and are reported here
 * instead. So this is a description of the trade, not a list of errors - a deck
 * with entries is fine, its author just knows what changed.
 */

import { summarizeSceneWarnings, type DeckScene, type SceneNode } from './scene.ts'

export type DeckExportLintEntry = {
  code: string
  message: string
  /** How many times it occurred across the deck. */
  count: number
}

export type DeckExportLint = {
  /** Node counts by kind, so a caller can say how much stayed editable. */
  nativeNodes: number
  rasterNodes: number
  /** Slides where at least one region flattened to a picture. */
  affectedSlides: number
  entries: DeckExportLintEntry[]
}

function isRaster(node: SceneNode) {
  return node.kind === 'raster'
}

/**
 * One sentence for the toast, or undefined when nothing degraded. Counts, not
 * codes: the detail belongs in a report, the headline belongs here.
 */
export function describeDeckExportLint(lint: DeckExportLint): string | undefined {
  const parts: string[] = []

  if (lint.rasterNodes > 0) {
    const regions = lint.rasterNodes === 1 ? '1 region' : `${lint.rasterNodes} regions`
    const slides = lint.affectedSlides === 1 ? '1 slide' : `${lint.affectedSlides} slides`
    parts.push(`${regions} on ${slides} exported as pictures`)
  }

  const weights = lint.entries.find((entry) => entry.code === 'font-weight-collapsed')
  if (weights) parts.push('some font weights collapsed to regular or bold')

  return parts.length ? parts.join('; ') : undefined
}

export function buildDeckExportLint(scene: DeckScene): DeckExportLint {
  let nativeNodes = 0
  let rasterNodes = 0
  let affectedSlides = 0

  for (const slide of scene.slides) {
    const rasters = slide.nodes.filter(isRaster).length
    rasterNodes += rasters
    nativeNodes += slide.nodes.length - rasters
    if (rasters > 0) affectedSlides += 1
  }

  return {
    nativeNodes,
    rasterNodes,
    affectedSlides,
    entries: summarizeSceneWarnings(scene.slides),
  }
}
