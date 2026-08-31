/**
 * The host-side pass over a slide the extractor returned.
 *
 * The in-page walk reports each run's raw CSS `font-family` rather than picking a
 * PowerPoint typeface itself, so the registry lookup stays in one tested place
 * instead of being duplicated into an injected string. This pass performs that
 * lookup, clamps geometry to the slide frame, and attaches the speaker notes the
 * deck parser already extracted.
 */

import { resolvePptxTypeface } from '@ark/runtime-registry/deck-font-registry.ts'

import {
  SCENE_FRAME_HEIGHT,
  SCENE_FRAME_WIDTH,
  type SceneNode,
  type SceneParagraph,
  type SceneRect,
  type SceneSlide,
  type SceneWarning,
} from './scene.ts'

function clampRect(rect: SceneRect): SceneRect {
  const width = Math.max(0, Math.min(rect.width, SCENE_FRAME_WIDTH))
  const height = Math.max(0, Math.min(rect.height, SCENE_FRAME_HEIGHT))

  return {
    ...rect,
    x: Math.max(0, Math.min(rect.x, SCENE_FRAME_WIDTH - width)),
    y: Math.max(0, Math.min(rect.y, SCENE_FRAME_HEIGHT - height)),
    width,
    height,
  }
}

function finalizeParagraphs(paragraphs: SceneParagraph[], collapsed: Set<number>) {
  return paragraphs.map((paragraph) => ({
    ...paragraph,
    runs: paragraph.runs.map((run) => {
      if (run.sourceWeight !== 400 && run.sourceWeight !== 700) collapsed.add(run.sourceWeight)
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
