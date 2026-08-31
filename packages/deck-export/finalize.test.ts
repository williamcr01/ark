import { describe, expect, it } from 'vitest'

import { finalizeSceneSlide } from './finalize.ts'
import { buildDeckExportLint, describeDeckExportLint } from './lint.ts'
import {
  pxToEmu,
  pxToInches,
  pxToPoints,
  SCENE_FRAME_HEIGHT,
  SCENE_FRAME_WIDTH,
  summarizeSceneWarnings,
  type SceneSlide,
  type SceneTextNode,
} from './scene.ts'

function run(overrides: Partial<SceneTextNode['paragraphs'][0]['runs'][0]> = {}) {
  return {
    text: 'Hello',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: '000000',
    alpha: 1,
    fontFace: '"Calibri", "Carlito", sans-serif',
    fontSize: 18,
    charSpacing: 0,
    sourceWeight: 400,
    ...overrides,
  }
}

function slideWith(nodes: SceneSlide['nodes']): SceneSlide {
  return { index: 0, background: { type: 'none' }, nodes, notes: null, warnings: [] }
}

function textNode(runs: ReturnType<typeof run>[], rect = { x: 0, y: 0, width: 100, height: 40 }) {
  return {
    kind: 'text' as const,
    rect,
    inset: { top: 0, right: 0, bottom: 0, left: 0 },
    lineCount: 1,
    paragraphs: [{ runs, align: 'left' as const }],
  }
}

describe('unit conversion', () => {
  it('maps the slide frame onto PowerPoint widescreen exactly', () => {
    expect(pxToInches(SCENE_FRAME_WIDTH)).toBeCloseTo(13.3333, 4)
    expect(pxToInches(SCENE_FRAME_HEIGHT)).toBe(7.5)
    // 12192000 x 6858000 EMU is the standard 16:9 slide.
    expect(pxToEmu(SCENE_FRAME_WIDTH)).toBe(12_192_000)
    expect(pxToEmu(SCENE_FRAME_HEIGHT)).toBe(6_858_000)
  })

  it('converts a pixel to exactly 9525 EMU, with no rounding', () => {
    expect(pxToEmu(1)).toBe(9525)
    expect(pxToPoints(16)).toBe(12)
  })
})

describe('finalizeSceneSlide', () => {
  it('resolves each run to a single PowerPoint typeface', () => {
    const slide = finalizeSceneSlide(slideWith([textNode([run()])]))
    const node = slide.nodes[0] as SceneTextNode

    expect(node.paragraphs[0].runs[0].fontFace).toBe('Calibri')
  })

  it('maps a platform stack PowerPoint cannot resolve', () => {
    const slide = finalizeSceneSlide(
      slideWith([textNode([run({ fontFace: '-apple-system, "Segoe UI", sans-serif' })])]),
    )
    const node = slide.nodes[0] as SceneTextNode

    expect(node.paragraphs[0].runs[0].fontFace).toBe('Calibri')
  })

  it('reports weights that collapse under the OOXML bold flag', () => {
    const slide = finalizeSceneSlide(
      slideWith([textNode([run({ sourceWeight: 600 }), run({ sourceWeight: 300 })])]),
    )

    const warning = slide.warnings.find((entry) => entry.code === 'font-weight-collapsed')
    expect(warning?.message).toContain('300, 600')
    expect(warning?.count).toBe(2)
  })

  it('stays quiet when every weight is 400 or 700', () => {
    const slide = finalizeSceneSlide(
      slideWith([textNode([run({ sourceWeight: 400 }), run({ sourceWeight: 700 })])]),
    )

    expect(slide.warnings).toEqual([])
  })

  it('clamps geometry into the slide frame', () => {
    const slide = finalizeSceneSlide(
      slideWith([textNode([run()], { x: 1200, y: 700, width: 400, height: 200 })]),
    )

    expect(slide.nodes[0].rect).toMatchObject({ x: 1200, y: 700, width: 80, height: 20 })
  })

  it('does not resize a node that already fits', () => {
    const slide = finalizeSceneSlide(
      slideWith([textNode([run()], { x: 10, y: 20, width: 300, height: 100 })]),
    )

    expect(slide.nodes[0].rect).toMatchObject({ x: 10, y: 20, width: 300, height: 100 })
  })

  it('clips an overflowing origin rather than shifting the box onto the slide', () => {
    const slide = finalizeSceneSlide(
      slideWith([textNode([run()], { x: -40, y: -10, width: 100, height: 50 })]),
    )

    expect(slide.nodes[0].rect).toMatchObject({ x: 0, y: 0, width: 60, height: 40 })
  })

  it('resolves typefaces inside table cells too', () => {
    const slide = finalizeSceneSlide(
      slideWith([
        {
          kind: 'table',
          rect: { x: 0, y: 0, width: 400, height: 200 },
          columnWidths: [200],
          rowHeights: [100],
          rows: [
            [
              {
                paragraphs: [{ runs: [run({ fontFace: 'Georgia, serif' })], align: 'left' }],
                colSpan: 1,
                rowSpan: 1,
                header: true,
              },
            ],
          ],
        },
      ]),
    )

    const table = slide.nodes[0]
    expect(table.kind === 'table' && table.rows[0][0].paragraphs[0].runs[0].fontFace).toBe(
      'Georgia',
    )
  })

  it('attaches the notes the deck parser already extracted', () => {
    const slide = finalizeSceneSlide(slideWith([]), { notes: 'Pause here.' })

    expect(slide.notes).toBe('Pause here.')
  })
})

describe('summarizeSceneWarnings', () => {
  it('tallies one code across slides, most frequent first', () => {
    const summary = summarizeSceneWarnings([
      { ...slideWith([]), warnings: [{ code: 'raster:filter', message: 'blur', count: 2 }] },
      {
        ...slideWith([]),
        warnings: [
          { code: 'raster:filter', message: 'blur', count: 3 },
          { code: 'canvas', message: 'chart', count: 1 },
        ],
      },
    ])

    expect(summary).toEqual([
      { code: 'raster:filter', message: 'blur', count: 5 },
      { code: 'canvas', message: 'chart', count: 1 },
    ])
  })
})

describe('buildDeckExportLint', () => {
  it('counts what stayed native against what flattened', () => {
    const lint = buildDeckExportLint({
      width: SCENE_FRAME_WIDTH,
      height: SCENE_FRAME_HEIGHT,
      slides: [
        {
          ...slideWith([
            textNode([run()]),
            { kind: 'raster', rect: { x: 0, y: 0, width: 10, height: 10 }, reason: 'filter' },
          ]),
          warnings: [{ code: 'raster:filter', message: 'blur', count: 1 }],
        },
        slideWith([textNode([run()])]),
      ],
    })

    expect(lint).toMatchObject({ nativeNodes: 2, rasterNodes: 1, affectedSlides: 1 })
    expect(describeDeckExportLint(lint)).toBe('1 region on 1 slide exported as pictures')
  })

  it('says nothing when the whole deck exported natively', () => {
    const lint = buildDeckExportLint({
      width: SCENE_FRAME_WIDTH,
      height: SCENE_FRAME_HEIGHT,
      slides: [slideWith([textNode([run()])])],
    })

    expect(describeDeckExportLint(lint)).toBeUndefined()
  })

  it('mentions collapsed weights alongside flattened regions', () => {
    const lint = buildDeckExportLint({
      width: SCENE_FRAME_WIDTH,
      height: SCENE_FRAME_HEIGHT,
      slides: [
        {
          ...slideWith([
            { kind: 'raster', rect: { x: 0, y: 0, width: 10, height: 10 }, reason: 'filter' },
          ]),
          warnings: [{ code: 'font-weight-collapsed', message: '600', count: 1 }],
        },
      ],
    })

    expect(describeDeckExportLint(lint)).toBe(
      '1 region on 1 slide exported as pictures; some font weights collapsed to regular or bold',
    )
  })
})
