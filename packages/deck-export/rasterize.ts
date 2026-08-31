/**
 * Turning the parts PowerPoint cannot draw into pictures.
 *
 * Two things need real pixels: regions the walk already marked `raster`, and
 * gradient fills - OOXML has gradients but pptxgenjs exposes only solid fills, so
 * a gradient is cropped from the slide capture instead of being approximated.
 *
 * A gradient-filled container keeps its children: the picture is inserted behind
 * them rather than replacing the subtree, so the text on a gradient hero slide
 * stays editable.
 */

import type { SceneNode, SceneRect, SceneSlide } from './scene.ts'

export type ScenePixelRequest = {
  /** Index of the node in the slide's node list. */
  nodeIndex: number
  rect: SceneRect
  reason: string
}

function needsGradientPixels(node: SceneNode) {
  if (node.kind === 'shape') return node.fill.type === 'gradient'
  if (node.kind === 'text') return node.fill?.type === 'gradient'
  return false
}

export function collectScenePixelRequests(slide: SceneSlide): ScenePixelRequest[] {
  const requests: ScenePixelRequest[] = []

  slide.nodes.forEach((node, nodeIndex) => {
    if (node.kind === 'raster' && !node.data) {
      requests.push({ nodeIndex, rect: node.rect, reason: node.reason })
      return
    }
    if (needsGradientPixels(node)) {
      requests.push({ nodeIndex, rect: node.rect, reason: 'gradient' })
    }
  })

  return requests
}

/**
 * Fold captured pixels back into the slide. A request with no pixels - capture
 * failed, or the rect fell outside the frame - is left alone so the emitter can
 * fall back rather than emit an empty picture.
 */
export function applyScenePixels(slide: SceneSlide, pixels: Map<number, string>): SceneSlide {
  const nodes: SceneNode[] = []

  slide.nodes.forEach((node, nodeIndex) => {
    const data = pixels.get(nodeIndex)

    if (!data) {
      nodes.push(node)
      return
    }

    if (node.kind === 'raster') {
      nodes.push({ ...node, data })
      return
    }

    if (node.kind === 'shape') {
      nodes.push({ kind: 'raster', rect: node.rect, reason: 'gradient', data })
      return
    }

    if (node.kind === 'text') {
      // Backdrop first, then the untouched text on top of it.
      nodes.push({ kind: 'raster', rect: node.rect, reason: 'gradient', data })
      nodes.push({ ...node, fill: undefined })
      return
    }

    nodes.push(node)
  })

  return { ...slide, nodes }
}
