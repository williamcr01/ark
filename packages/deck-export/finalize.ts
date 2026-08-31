/**
 * The host-side pass over a slide the extractor returned.
 *
 * The in-page walk reports each run's raw CSS `font-family` rather than picking a
 * PowerPoint typeface itself, so the registry lookup stays in one tested place
 * instead of being duplicated into an injected string. This pass performs that
 * lookup, clamps geometry to the slide frame, and attaches the speaker notes the
 * deck parser already extracted.
 */

import {
  isExportSafeFontWeight,
  resolvePptxTypeface,
} from '@ark/runtime-registry/deck-font-registry.ts'

import {
  clampRect,
  type SceneNode,
  type SceneParagraph,
  type SceneSlide,
  type SceneWarning,
} from './scene.ts'

function finalizeParagraphs(paragraphs: SceneParagraph[], collapsed: Set<number>) {
  return paragraphs.map((paragraph) => ({
    ...paragraph,
    runs: paragraph.runs.map((run) => {
      if (!isExportSafeFontWeight(run.sourceWeight)) collapsed.add(run.sourceWeight)
      return { ...run, fontFace: resolvePptxTypeface(run.fontFace) }
    }),
  }))
}

function finalizeNode(node: SceneNode, collapsed: Set<number>): SceneNode {
  const rect = clampRect(node.rect)

  if (node.kind === 'text') {
    return { ...node, rect, paragraphs: finalizeParagraphs(node.paragraphs, collapsed) }
  }
  if (node.kind === 'table') {
    return {
      ...node,
      rect,
      rows: node.rows.map((row) =>
        row.map((cell) => ({
          ...cell,
          paragraphs: finalizeParagraphs(cell.paragraphs, collapsed),
        })),
      ),
    }
  }

  return { ...node, rect }
}

export type FinalizeSceneSlideOptions = {
  notes?: string | null
}

export function finalizeSceneSlide(
  slide: SceneSlide,
  options: FinalizeSceneSlideOptions = {},
): SceneSlide {
  const collapsed = new Set<number>()
  const nodes = slide.nodes.map((node) => finalizeNode(node, collapsed))
  const warnings: SceneWarning[] = [...slide.warnings]

  if (collapsed.size > 0) {
    warnings.push({
      code: 'font-weight-collapsed',
      message: `PowerPoint carries a bold flag, not a weight axis: ${[...collapsed]
        .sort((a, b) => a - b)
        .join(', ')} collapses to regular or bold.`,
      count: collapsed.size,
    })
  }

  return {
    ...slide,
    nodes,
    notes: options.notes ?? slide.notes ?? null,
    warnings,
  }
}
