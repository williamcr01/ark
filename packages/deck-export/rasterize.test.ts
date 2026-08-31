import { describe, expect, it } from 'vitest'

import { applyScenePixels, collectScenePixelRequests } from './rasterize.ts'
import {
  SCENE_FRAME_HEIGHT,
  SCENE_FRAME_WIDTH,
  type SceneFill,
  type SceneNode,
  type SceneSlide,
} from './scene.ts'

const GRADIENT: SceneFill = {
  type: 'gradient',
  angle: 90,
  stops: [
    { color: '000000', alpha: 1, position: 0 },
    { color: 'FFFFFF', alpha: 1, position: 100 },
  ],
}

const RECT = { x: 0, y: 0, width: 100, height: 100 }

function slideWith(nodes: SceneNode[]): SceneSlide {
  return { index: 0, background: { type: 'none' }, nodes, notes: null, warnings: [] }
}

const shape = (fill: SceneFill): SceneNode => ({
  kind: 'shape',
  rect: RECT,
  shape: 'rect',
  radius: 0,
  fill,
})

const text = (fill?: SceneFill): SceneNode => ({
  kind: 'text',
  rect: RECT,
  inset: { top: 0, right: 0, bottom: 0, left: 0 },
  paragraphs: [],
  lineCount: 1,
  fill,
})

describe('collectScenePixelRequests', () => {
  it('asks for pixels for raster regions and gradient fills', () => {
    const slide = slideWith([
      { kind: 'raster', rect: RECT, reason: 'filter' },
      shape(GRADIENT),
      shape({ type: 'solid', color: 'FF0000', alpha: 1 }),
      text(GRADIENT),
    ])

    expect(collectScenePixelRequests(slide).map((request) => request.reason)).toEqual([
      'filter',
      'gradient',
      'gradient',
    ])
  })

  it('does not re-request a raster region that already has pixels', () => {
    const slide = slideWith([{ kind: 'raster', rect: RECT, reason: 'filter', data: 'data:,x' }])

    expect(collectScenePixelRequests(slide)).toEqual([])
  })

  it('crops overflowing and rotated rects to the on-slide AABB', () => {
    const slide = slideWith([
      { kind: 'raster', rect: { x: 1200, y: 700, width: 400, height: 200 }, reason: 'filter' },
      {
        kind: 'raster',
        rect: { x: 100, y: 100, width: 100, height: 50, rotation: 90 },
        reason: 'svg',
      },
    ])

    expect(collectScenePixelRequests(slide).map((request) => request.rect)).toEqual([
      { x: 1200, y: 700, width: SCENE_FRAME_WIDTH - 1200, height: SCENE_FRAME_HEIGHT - 700 },
      { x: 125, y: 75, width: 50, height: 100 },
    ])
  })
})

describe('applyScenePixels', () => {
  it('attaches pixels to a raster region', () => {
    const slide = applyScenePixels(
      slideWith([{ kind: 'raster', rect: RECT, reason: 'filter' }]),
      new Map([[0, 'data:image/png;base64,AAA']]),
    )

    expect(slide.nodes[0]).toMatchObject({ kind: 'raster', data: 'data:image/png;base64,AAA' })
  })

  it('replaces a gradient shape with the captured picture', () => {
    const slide = applyScenePixels(slideWith([shape(GRADIENT)]), new Map([[0, 'data:,pixels']]))

    expect(slide.nodes).toHaveLength(1)
    expect(slide.nodes[0]).toMatchObject({
      kind: 'raster',
      reason: 'gradient',
      data: 'data:,pixels',
    })
  })

  it('keeps text on a gradient editable by putting the picture behind it', () => {
    const slide = applyScenePixels(slideWith([text(GRADIENT)]), new Map([[0, 'data:,pixels']]))

    expect(slide.nodes.map((node) => node.kind)).toEqual(['raster', 'text'])
    expect(slide.nodes[1].kind === 'text' && slide.nodes[1].fill).toBeUndefined()
  })

  it('leaves a node alone when its capture failed', () => {
    const slide = applyScenePixels(slideWith([shape(GRADIENT)]), new Map())

    expect(slide.nodes[0]).toMatchObject({ kind: 'shape' })
  })

  it('places captured pixels on the visible crop, not the overflowing source rect', () => {
    const slide = applyScenePixels(
      slideWith([
        {
          kind: 'raster',
          rect: { x: 1200, y: 700, width: 400, height: 200 },
          reason: 'filter',
        },
      ]),
      new Map([[0, 'data:,pixels']]),
    )

    expect(slide.nodes[0].rect).toEqual({
      x: 1200,
      y: 700,
      width: SCENE_FRAME_WIDTH - 1200,
      height: SCENE_FRAME_HEIGHT - 700,
    })
  })

  it('drops rotation from a captured raster because the pixels are already rotated', () => {
    const slide = applyScenePixels(
      slideWith([
        {
          kind: 'raster',
          rect: { x: 100, y: 100, width: 100, height: 50, rotation: 90 },
          reason: 'svg',
        },
      ]),
      new Map([[0, 'data:,pixels']]),
    )

    expect(slide.nodes[0].rect).toEqual({ x: 125, y: 75, width: 50, height: 100 })
  })
})
