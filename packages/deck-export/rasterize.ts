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

import { sceneCaptureRect, type SceneNode, type SceneRect, type SceneSlide } from './scene.ts'

/** Marks a gradient fill whose descendants must be hidden for a fill-only crop. */
export const SCENE_FILL_CAPTURE_ATTR = 'data-ark-scene-fill-capture'

export type ScenePixelRequest = {
  /** Index of the node in the slide's node list. */
  nodeIndex: number
  /** On-slide crop box, already AABB-clamped and integer. */
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
    const reason =
      node.kind === 'raster' && !node.data
        ? node.reason
        : needsGradientPixels(node)
          ? 'gradient'
          : null
    if (!reason) return

    const rect = sceneCaptureRect(node.rect)
    if (rect.width <= 0 || rect.height <= 0) return
    requests.push({ nodeIndex, rect, reason })
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

    const rect = sceneCaptureRect(node.rect)

    if (node.kind === 'raster') {
      nodes.push({ ...node, rect, data })
      return
    }

    if (node.kind === 'shape') {
      nodes.push({ kind: 'raster', rect, reason: 'gradient', data })
      return
    }

    if (node.kind === 'text') {
      // Backdrop first, then the untouched text on top of it.
      nodes.push({ kind: 'raster', rect, reason: 'gradient', data })
      nodes.push({ ...node, fill: undefined })
      return
    }

    nodes.push(node)
  })

  return { ...slide, nodes }
}
