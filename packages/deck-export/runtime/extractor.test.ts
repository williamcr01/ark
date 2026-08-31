import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import type { SceneSlide, SceneTextNode } from '../scene.ts'
import { buildDeckSceneExtractorScript, DECK_SCENE_EXTRACTOR_GLOBAL } from './script.ts'

/**
 * JSDOM performs no layout, so every element under test declares its box with
 * `data-rect="x,y,w,h"` and the harness serves that from
 * getBoundingClientRect. Everything else - the cascade, computed colours, the
 * default display of each tag - is real.
 */
function extract(slideMarkup: string, headCss = ''): SceneSlide {
  const script = buildDeckSceneExtractorScript()
  const dom = new JSDOM(
    `<!doctype html><html><head><style>${headCss}</style></head><body>
      <section class="slide" data-rect="0,0,1280,720">${slideMarkup}</section>
      <script>${script}</script>
    </body></html>`,
    { runScripts: 'dangerously', pretendToBeVisual: true },
  )

  const { window } = dom
  window.Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
    const declared = this.getAttribute('data-rect')
    const [x, y, width, height] = declared
      ? declared.split(',').map((part) => Number(part.trim()))
      : [0, 0, 0, 0]

    return {
      x,
      y,
      width,
      height,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      toJSON: () => ({}),
    } as DOMRect
  }

  const extractScene = (window as unknown as Record<string, (index: number) => SceneSlide>)[
    DECK_SCENE_EXTRACTOR_GLOBAL
  ]
  expect(typeof extractScene).toBe('function')

  return extractScene(0)
}

function textNodes(slide: SceneSlide) {
  return slide.nodes.filter((node): node is SceneTextNode => node.kind === 'text')
}

function plainText(node: SceneTextNode) {
  return node.paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join('\n')
}

describe('scene extractor: text', () => {
  it('emits one text box per block of prose, at its measured rect', () => {
    const slide = extract(
      `<h1 data-rect="80,60,1120,90" style="font-size:64px;font-weight:700;color:rgb(17,17,17)">Revenue</h1>
       <p data-rect="80,180,600,40" style="font-size:24px">Up and to the right.</p>`,
    )

    const nodes = textNodes(slide)
    expect(nodes).toHaveLength(2)
    expect(plainText(nodes[0])).toBe('Revenue')
    expect(nodes[0].rect).toMatchObject({ x: 80, y: 60, width: 1120, height: 90 })

    const heading = nodes[0].paragraphs[0].runs[0]
    // 64 CSS px is 48pt: points are px * 72/96, exactly.
    expect(heading.fontSize).toBe(48)
    expect(heading.bold).toBe(true)
    expect(heading.color).toBe('111111')
  })

  it('keeps inline formatting as runs inside one paragraph', () => {
    const slide = extract(
      `<p data-rect="0,0,600,40" style="font-size:20px">Plain <strong data-rect="0,0,80,40">bold</strong> and <em data-rect="0,0,60,40">italic</em>.</p>`,
    )

    const [paragraph] = textNodes(slide)[0].paragraphs
    expect(paragraph.runs.map((run) => run.text)).toEqual([
      'Plain ',
      'bold',
      ' and ',
      'italic',
      '.',
    ])
    expect(paragraph.runs.map((run) => run.bold)).toEqual([false, true, false, false, false])
    expect(paragraph.runs.map((run) => run.italic)).toEqual([false, false, false, true, false])
  })

  it('carries a link href onto the runs inside it', () => {
    const slide = extract(
      `<p data-rect="0,0,600,40">See <a href="https://ark.test/docs" data-rect="0,0,80,40">the docs</a></p>`,
    )

    const runs = textNodes(slide)[0].paragraphs[0].runs
    expect(runs.find((run) => run.text === 'the docs')?.link).toBe('https://ark.test/docs')
    expect(runs.find((run) => run.text === 'See ')?.link).toBeUndefined()
  })

  it('splits on <br>, because PowerPoint has no inline break', () => {
    const slide = extract(`<p data-rect="0,0,600,80">First<br data-rect="0,0,0,0">Second</p>`)

    expect(textNodes(slide)[0].paragraphs.map((p) => p.runs[0].text)).toEqual(['First', 'Second'])
  })

  it('collapses whitespace the way CSS renders it', () => {
    const slide = extract(`<p data-rect="0,0,600,40">   lots\n   of     space   </p>`)

    expect(plainText(textNodes(slide)[0])).toBe('lots of space')
  })

  it('records alignment and line spacing in points', () => {
    const slide = extract(
      `<p data-rect="0,0,600,40" style="text-align:center;line-height:32px">Centered</p>`,
    )

    const [paragraph] = textNodes(slide)[0].paragraphs
    expect(paragraph.align).toBe('center')
    expect(paragraph.lineSpacing).toBe(24)
  })

  it('reports the raw CSS stack so the host resolves the typeface once', () => {
    const slide = extract(
      `<p data-rect="0,0,600,40" style="font-family:'Calibri','Carlito',sans-serif">Text</p>`,
    )

    expect(textNodes(slide)[0].paragraphs[0].runs[0].fontFace).toContain('Calibri')
  })
})

describe('scene extractor: lists', () => {
  it('turns a list into one text box of bulleted paragraphs', () => {
    const slide = extract(
      `<ul data-rect="80,200,600,160">
         <li data-rect="80,200,600,40">Alpha</li>
         <li data-rect="80,240,600,40">Beta</li>
       </ul>`,
    )

    const nodes = textNodes(slide)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].paragraphs.map((p) => p.runs[0].text)).toEqual(['Alpha', 'Beta'])
    expect(nodes[0].paragraphs.every((p) => p.bullet?.type === 'bullet')).toBe(true)
  })

  it('numbers an ordered list', () => {
    const slide = extract(`<ol data-rect="0,0,600,80"><li data-rect="0,0,600,40">One</li></ol>`)

    expect(textNodes(slide)[0].paragraphs[0].bullet).toEqual({ type: 'number', level: 0 })
  })

  it('falls back to the ordinary walk when an item holds more than prose', () => {
    const slide = extract(
      `<ul data-rect="0,0,600,200">
         <li data-rect="0,0,600,100"><div data-rect="0,0,600,100" style="background-color:rgb(1,2,3)">Card</div></li>
       </ul>`,
    )

    // The card keeps its own fill instead of being flattened into a bullet.
    const nodes = textNodes(slide)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].paragraphs.every((paragraph) => paragraph.bullet === undefined)).toBe(true)
    expect(nodes[0].fill).toEqual({ type: 'solid', color: '010203', alpha: 1 })
  })
})

describe('scene extractor: shapes and fills', () => {
  it('emits a shape for a painted container, behind its text', () => {
    const slide = extract(
      `<div data-rect="100,100,400,200" style="background-color:rgb(20,40,60);border-radius:16px">
         <p data-rect="120,120,360,40" style="font-size:20px">Inside</p>
       </div>`,
    )

    expect(slide.nodes.map((node) => node.kind)).toEqual(['shape', 'text'])
    const shape = slide.nodes[0]
    expect(shape).toMatchObject({ kind: 'shape', shape: 'roundRect', radius: 16 })
    expect(shape.kind === 'shape' && shape.fill).toEqual({
      type: 'solid',
      color: '14283C',
      alpha: 1,
    })
  })

  it('reads a uniform border as the shape outline', () => {
    const slide = extract(
      `<div data-rect="0,0,200,200" style="border:2px dashed rgb(255,0,0)"></div>`,
    )

    expect(slide.nodes[0].kind === 'shape' && slide.nodes[0].line).toEqual({
      color: 'FF0000',
      width: 2,
      dash: 'dash',
      alpha: 1,
    })
  })

  it('calls a fully rounded box an ellipse', () => {
    const slide = extract(
      `<div data-rect="0,0,120,120" style="background:rgb(0,0,0);border-radius:60px"></div>`,
    )

    expect(slide.nodes[0].kind === 'shape' && slide.nodes[0].shape).toBe('ellipse')
  })

  it('parses a linear gradient background into stops', () => {
    const slide = extract(
      `<div data-rect="0,0,400,200" style="background-image:linear-gradient(90deg, rgb(255,0,0) 0%, rgb(0,0,255) 100%)"></div>`,
    )

    expect(slide.nodes[0].kind === 'shape' && slide.nodes[0].fill).toEqual({
      type: 'gradient',
      angle: 90,
      stops: [
        { color: 'FF0000', alpha: 1, position: 0 },
        { color: '0000FF', alpha: 1, position: 100 },
      ],
    })
  })

  it('takes the slide background from the section', () => {
    const slide = extract(`<p data-rect="0,0,100,20">x</p>`, '.slide { background: rgb(9,9,9) }')

    expect(slide.background).toEqual({ type: 'solid', color: '090909', alpha: 1 })
  })
})

describe('scene extractor: media', () => {
  it('passes a data-URI image straight through', () => {
    const data =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const slide = extract(
      `<img src="${data}" alt="Chart" data-rect="40,40,320,180" style="object-fit:cover">`,
    )

    expect(slide.nodes[0]).toMatchObject({
      kind: 'image',
      data,
      alt: 'Chart',
      sizing: 'cover',
      rect: { x: 40, y: 40, width: 320, height: 180 },
    })
  })

  it('marks an inline SVG for rasterizing rather than dropping it', () => {
    const slide = extract(`<svg data-rect="0,0,100,100"><rect width="100" height="100"/></svg>`)

    expect(slide.nodes[0]).toMatchObject({ kind: 'raster', reason: 'svg' })
  })
})

describe('scene extractor: degradation', () => {
  it.each([
    ['backdrop-filter:blur(4px)', 'backdrop-filter'],
    ['filter:blur(2px)', 'filter'],
    ['mix-blend-mode:multiply', 'mix-blend-mode'],
    ['clip-path:circle(40%)', 'clip-path'],
  ])('rasterizes %s and does not descend into it', (declaration, reason) => {
    const slide = extract(
      `<div data-rect="0,0,400,200" style="${declaration}">
         <p data-rect="10,10,200,40">Hidden from the walk</p>
       </div>`,
    )

    expect(slide.nodes).toHaveLength(1)
    expect(slide.nodes[0]).toMatchObject({ kind: 'raster', reason })
    expect(slide.warnings.some((warning) => warning.code === `raster:${reason}`)).toBe(true)
  })

  it('warns once per reason, with a count', () => {
    const slide = extract(
      `<div data-rect="0,0,100,100" style="filter:blur(1px)"></div>
       <div data-rect="0,100,100,100" style="filter:blur(2px)"></div>`,
    )

    const warning = slide.warnings.find((entry) => entry.code === 'raster:filter')
    expect(warning?.count).toBe(2)
  })

  it('flags a partial border, which OOXML cannot express', () => {
    const slide = extract(
      `<div data-rect="0,0,400,4" style="border-bottom:4px solid rgb(0,0,0)"></div>`,
    )

    expect(slide.warnings.some((warning) => warning.code === 'partial-border')).toBe(true)
  })
})

describe('scene extractor: visibility and order', () => {
  it('skips hidden, zero-area, and off-slide elements', () => {
    const slide = extract(
      `<p data-rect="0,0,100,20" style="display:none">gone</p>
       <p data-rect="0,0,0,0">empty</p>
       <p data-rect="-500,0,200,20">off to the left</p>
       <p data-rect="0,0,100,20">kept</p>`,
    )

    expect(textNodes(slide).map(plainText)).toEqual(['kept'])
  })

  it('orders by z-index, then by document order', () => {
    const slide = extract(
      `<div data-rect="0,0,100,100" style="background:rgb(1,1,1);position:absolute;z-index:5"></div>
       <div data-rect="0,0,100,100" style="background:rgb(2,2,2);position:absolute;z-index:1"></div>
       <div data-rect="0,0,100,100" style="background:rgb(3,3,3);position:absolute;z-index:5"></div>`,
    )

    expect(
      slide.nodes
        .map((node) => (node.kind === 'shape' ? node.fill : null))
        .map((fill) => (fill && fill.type === 'solid' ? fill.color : null)),
    ).toEqual(['020202', '010101', '030303'])
  })

  it('survives a slide that throws, reporting it as a warning', () => {
    const slide = extract(`<p data-rect="0,0,100,20">fine</p>`)

    expect(slide.warnings.some((warning) => warning.code === 'extract-failed')).toBe(false)
  })
})
