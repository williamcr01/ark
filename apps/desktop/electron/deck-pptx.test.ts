/**
 * Electron main-process code: no DOM, and jsdom's realm would break
 * `instanceof` checks in libraries that run against Node's globals.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import type { DeckScene, SceneNode, SceneParagraph, SceneSlide } from '@ark/deck-export'
import { SCENE_FRAME_HEIGHT, SCENE_FRAME_WIDTH } from '@ark/deck-export'

import { generateDeckPptx, readPptxSlideText, readPptxSlideXml } from './deck-pptx.ts'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function paragraph(text: string, overrides: Partial<SceneParagraph> = {}): SceneParagraph {
  return {
    align: 'left',
    runs: [
      {
        text,
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        color: '112233',
        alpha: 1,
        fontFace: 'Calibri',
        fontSize: 18,
        charSpacing: 0,
        sourceWeight: 400,
      },
    ],
    ...overrides,
  }
}

function scene(nodes: SceneNode[], slideOverrides: Partial<SceneSlide> = {}): DeckScene {
  return {
    width: SCENE_FRAME_WIDTH,
    height: SCENE_FRAME_HEIGHT,
    slides: [
      {
        index: 0,
        background: { type: 'solid', color: 'FFFFFF', alpha: 1 },
        nodes,
        notes: null,
        warnings: [],
        ...slideOverrides,
      },
    ],
  }
}

async function firstSlideXml(deckScene: DeckScene) {
  const [xml] = await readPptxSlideXml(await generateDeckPptx(deckScene, 'Test Deck'))
  return xml
}

const textNode = (paragraphs: SceneParagraph[], lineCount = paragraphs.length): SceneNode => ({
  kind: 'text',
  rect: { x: 64, y: 48, width: 640, height: 96 },
  inset: { top: 0, right: 0, bottom: 0, left: 0 },
  paragraphs,
  lineCount,
})

describe('PowerPoint emitter', () => {
  it('writes one slide per scene slide', async () => {
    const deck = scene([textNode([paragraph('One')])])
    deck.slides.push({ ...deck.slides[0], index: 1 })

    expect(await readPptxSlideXml(await generateDeckPptx(deck, 'Test'))).toHaveLength(2)
  })

  it('emits text as editable runs, not a picture', async () => {
    const xml = await firstSlideXml(scene([textNode([paragraph('Quarterly revenue')])]))

    expect(readPptxSlideText(xml)).toEqual(['Quarterly revenue'])
    expect(xml).toContain('typeface="Calibri"')
    expect(xml).not.toContain('<p:pic>')
  })

  it('positions a text box in EMU taken straight from the scene pixels', async () => {
    const xml = await firstSlideXml(scene([textNode([paragraph('Placed')])]))

    // 64px and 48px at exactly 9525 EMU per pixel.
    expect(xml).toContain(`x="${64 * 9525}"`)
    expect(xml).toContain(`y="${48 * 9525}"`)
    expect(xml).toContain(`cx="${640 * 9525}"`)
  })

  it('carries bold, italic, colour, and size onto the run', async () => {
    const styled = paragraph('Styled')
    styled.runs[0] = {
      ...styled.runs[0],
      bold: true,
      italic: true,
      color: 'FF0000',
      fontSize: 32,
    }
    const xml = await firstSlideXml(scene([textNode([styled])]))

    expect(xml).toMatch(/b="1"/)
    expect(xml).toMatch(/i="1"/)
    expect(xml).toContain('FF0000')
    // OOXML sizes are hundredths of a point.
    expect(xml).toContain('sz="3200"')
  })

  it('keeps a list as bulleted paragraphs', async () => {
    const xml = await firstSlideXml(
      scene([
        textNode([
          paragraph('First', { bullet: { type: 'bullet', level: 0 } }),
          paragraph('Second', { bullet: { type: 'bullet', level: 0 } }),
        ]),
      ]),
    )

    expect(readPptxSlideText(xml)).toEqual(['First', 'Second'])
    expect(xml).toContain('buChar')
  })

  it('numbers an ordered list', async () => {
    const xml = await firstSlideXml(
      scene([textNode([paragraph('Step one', { bullet: { type: 'number', level: 0 } })])]),
    )

    expect(xml).toContain('buAutoNum')
  })

  it('forbids wrapping for text the browser fitted on one line', async () => {
    const xml = await firstSlideXml(scene([textNode([paragraph('02')], 1)]))

    expect(xml).toContain('wrap="none"')
  })

  it('allows wrapping once the text already spans more than one line', async () => {
    const xml = await firstSlideXml(scene([textNode([paragraph('A longer sentence.')], 2)]))

    expect(xml).toContain('wrap="square"')
  })

  it('maps padding onto the insets pptxgenjs expects, which is not CSS order', async () => {
    const xml = await firstSlideXml(
      scene([
        {
          kind: 'text',
          rect: { x: 0, y: 0, width: 400, height: 200 },
          // Deliberately asymmetric: a transposed array would show up as swapped
          // horizontal and vertical insets, narrowing the text and forcing a wrap.
          inset: { top: 8, right: 16, bottom: 24, left: 32 },
          paragraphs: [paragraph('Inset')],
          lineCount: 1,
        },
      ]),
    )

    // Points to EMU: 32px = 24pt = 304800 EMU, 8px = 6pt = 76200 EMU.
    expect(xml).toContain(`lIns="${24 * 12700}"`)
    expect(xml).toContain(`rIns="${12 * 12700}"`)
    expect(xml).toContain(`bIns="${18 * 12700}"`)
    expect(xml).toContain(`tIns="${6 * 12700}"`)
  })

  it('emits a shape with its fill, outline, and corner radius', async () => {
    const xml = await firstSlideXml(
      scene([
        {
          kind: 'shape',
          rect: { x: 0, y: 0, width: 400, height: 200 },
          shape: 'roundRect',
          radius: 20,
          fill: { type: 'solid', color: '2A3F55', alpha: 1 },
          line: { color: '000000', width: 2, dash: 'dash', alpha: 1 },
        },
      ]),
    )

    expect(xml).toContain('roundRect')
    expect(xml).toContain('2A3F55')
    expect(xml).toContain('dash')
  })

  it('renders a gradient fill as a solid average when no pixels were captured', async () => {
    const xml = await firstSlideXml(
      scene([
        {
          kind: 'shape',
          rect: { x: 0, y: 0, width: 400, height: 200 },
          shape: 'rect',
          radius: 0,
          fill: {
            type: 'gradient',
            angle: 90,
            stops: [
              { color: '000000', alpha: 1, position: 0 },
              { color: 'FFFFFF', alpha: 1, position: 100 },
            ],
          },
        },
      ]),
    )

    // Midpoint of black and white, so the shape still reads as mid-grey.
    expect(xml).toContain('808080')
  })

  it('places a captured raster region as a picture', async () => {
    const xml = await firstSlideXml(
      scene([
        {
          kind: 'raster',
          rect: { x: 10, y: 10, width: 100, height: 100 },
          reason: 'filter',
          data: PNG,
        },
      ]),
    )

    expect(xml).toContain('<p:pic>')
  })

  it('skips a raster region whose capture failed rather than emitting an empty picture', async () => {
    const xml = await firstSlideXml(
      scene([{ kind: 'raster', rect: { x: 0, y: 0, width: 10, height: 10 }, reason: 'filter' }]),
    )

    expect(xml).not.toContain('<p:pic>')
  })

  it('does not re-rotate a captured raster; the pixels are already screen-rotated', async () => {
    const xml = await firstSlideXml(
      scene([
        {
          kind: 'raster',
          rect: { x: 10, y: 10, width: 100, height: 100, rotation: 45 },
          reason: 'filter',
          data: PNG,
        },
      ]),
    )

    expect(xml).toContain('<p:pic>')
    expect(xml).not.toMatch(/rot="[1-9]/)
  })

  it('rotates a native image whose source pixels are unrotated', async () => {
    const xml = await firstSlideXml(
      scene([
        {
          kind: 'image',
          rect: { x: 10, y: 10, width: 100, height: 100, rotation: 45 },
          data: PNG,
          sizing: 'contain',
          alt: '',
        },
      ]),
    )

    expect(xml).toMatch(/rot="2700000"/)
  })

  it('emits a table with real cell text', async () => {
    const xml = await firstSlideXml(
      scene([
        {
          kind: 'table',
          rect: { x: 0, y: 0, width: 400, height: 100 },
          columnWidths: [200, 200],
          rowHeights: [50, 50],
          rows: [
            [
              { paragraphs: [paragraph('Region')], colSpan: 1, rowSpan: 1, header: true },
              { paragraphs: [paragraph('Revenue')], colSpan: 1, rowSpan: 1, header: true },
            ],
            [
              { paragraphs: [paragraph('EMEA')], colSpan: 1, rowSpan: 1, header: false },
              { paragraphs: [paragraph('4.2M')], colSpan: 1, rowSpan: 1, header: false },
            ],
          ],
        },
      ]),
    )

    expect(xml).toContain('<a:tbl>')
    expect(readPptxSlideText(xml)).toEqual(['Region', 'Revenue', 'EMEA', '4.2M'])
  })

  it('sets the slide background and speaker notes', async () => {
    const deck = scene([textNode([paragraph('Body')])], {
      background: { type: 'solid', color: '112233', alpha: 1 },
      notes: 'Pause after the headline.',
    })
    const pptx = await generateDeckPptx(deck, 'Test')
    const [xml] = await readPptxSlideXml(pptx)

    expect(xml).toContain('112233')
    expect(pptx.subarray(0, 2).toString('ascii')).toBe('PK')
  })
})
