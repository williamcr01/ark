/**
 * Scene to PowerPoint.
 *
 * Every node becomes a native shape the recipient can select, move, and retype.
 * The only pictures in the output are regions the walk could not express - and
 * those arrive pre-cropped, so even a rasterized backdrop keeps the text on top
 * of it editable.
 *
 * Units: the scene is CSS px on a 1280x720 frame, PowerPoint wants inches on a
 * 13.333in x 7.5in slide, and the two are the same thing at 96dpi.
 */

import PptxGenJS from 'pptxgenjs'

import {
  pxToInches,
  pxToPoints,
  type DeckScene,
  type SceneFill,
  type SceneLine,
  type SceneNode,
  type SceneParagraph,
  type SceneRect,
  type SceneShadow,
  type SceneSlide,
  type SceneTableNode,
  type SceneTextNode,
} from '@ark/deck-export'

type TextRunSpec = {
  text: string
  options: Record<string, unknown>
}

function position(rect: SceneRect) {
  return {
    x: pxToInches(rect.x),
    y: pxToInches(rect.y),
    w: pxToInches(rect.width),
    h: pxToInches(rect.height),
  }
}

/** OOXML expresses opacity as transparency, inverted and in percent. */
function transparency(alpha: number) {
  return Math.round((1 - Math.max(0, Math.min(1, alpha))) * 100)
}

function solidFill(fill: SceneFill | undefined) {
  if (!fill || fill.type !== 'solid') return undefined
  return { color: fill.color, transparency: transparency(fill.alpha) }
}

/**
 * Average a gradient's stops. Only reached when the slide capture failed, since
 * a gradient is normally cropped to a picture that looks exactly right.
 */
function averageGradient(fill: SceneFill) {
  if (fill.type !== 'gradient' || fill.stops.length === 0) return undefined

  const channels = [0, 1, 2].map((channel) =>
    Math.round(
      fill.stops.reduce(
        (total, stop) =>
          total + Number.parseInt(stop.color.slice(channel * 2, channel * 2 + 2), 16),
        0,
      ) / fill.stops.length,
    ),
  )

  return {
    color: channels
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase(),
    transparency: 0,
  }
}

function shapeFill(fill: SceneFill | undefined) {
  if (!fill || fill.type === 'none') return undefined
  return fill.type === 'solid' ? solidFill(fill) : averageGradient(fill)
}

const DASH_TYPES = { solid: 'solid', dash: 'dash', dot: 'sysDot' } as const

function shapeLine(line: SceneLine | undefined) {
  if (!line) return undefined
  return {
    color: line.color,
    width: pxToPoints(line.width),
    dashType: DASH_TYPES[line.dash],
    transparency: transparency(line.alpha),
  }
}

/** PowerPoint places a shadow by angle and distance, not by x/y offset. */
function shapeShadow(shadow: SceneShadow | undefined) {
  if (!shadow) return undefined

  const offset = Math.hypot(shadow.offsetX, shadow.offsetY)
  const angle =
    (Math.round((Math.atan2(shadow.offsetY, shadow.offsetX) * 180) / Math.PI) + 360) % 360

  return {
    type: 'outer' as const,
    color: shadow.color,
    opacity: Math.max(0, Math.min(1, shadow.alpha)),
    blur: pxToPoints(shadow.blur),
    offset: pxToPoints(offset),
    angle,
  }
}

function runOptions(run: SceneTextRunLike, paragraph: SceneParagraph, isLast: boolean) {
  const options: Record<string, unknown> = {
    bold: run.bold,
    italic: run.italic,
    color: run.color,
    fontFace: run.fontFace,
    fontSize: run.fontSize,
    align: paragraph.align,
    breakLine: isLast,
  }

  if (run.underline) options.underline = { style: 'sng' }
  if (run.strike) options.strike = 'sngStrike'
  if (run.charSpacing) options.charSpacing = run.charSpacing
  if (run.alpha < 1) options.transparency = transparency(run.alpha)
  if (run.link) options.hyperlink = { url: run.link }
  if (paragraph.lineSpacing) options.lineSpacing = paragraph.lineSpacing
  if (paragraph.bullet) {
    // pptxgenjs only inspects `type` to look for 'number'; a `{ type: 'bullet' }`
    // object falls through every branch and emits no bullet at all, so a plain
    // bullet has to be requested as `true`.
    options.bullet = paragraph.bullet.type === 'number' ? { type: 'number' } : true
    options.indentLevel = paragraph.bullet.level
  }

  return options
}

type SceneTextRunLike = SceneParagraph['runs'][number]

function textRuns(paragraphs: SceneParagraph[]): TextRunSpec[] {
  const runs: TextRunSpec[] = []

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const isLastParagraph = paragraphIndex === paragraphs.length - 1

    paragraph.runs.forEach((run, runIndex) => {
      const isLastRun = runIndex === paragraph.runs.length - 1
      runs.push({
        text: run.text,
        // A break ends every paragraph but the final one, which is how
        // PowerPoint separates paragraphs inside a single text box.
        options: runOptions(run, paragraph, isLastRun && !isLastParagraph),
      })
    })
  })

  return runs
}

function addText(slide: PptxGenJS.Slide, node: SceneTextNode) {
  const runs = textRuns(node.paragraphs)
  if (runs.length === 0) return

  slide.addText(
    runs as never,
    {
      ...position(node.rect),
      // Ark measured the rendered box, so PowerPoint must not re-flow or re-fit it.
      valign: 'top',
      isTextBox: true,
      // Text the browser fitted on one line must stay on one line. PowerPoint's
      // glyph advances differ just enough that a tightly-measured label - a lone
      // "02", a short stat - breaks onto a second row. Overflowing by a hair is
      // far less visible than an unexpected wrap.
      wrap: node.lineCount > 1,
      // pptxgenjs reads this array as [left, right, bottom, top], not CSS order.
      margin: [
        pxToPoints(node.inset.left),
        pxToPoints(node.inset.right),
        pxToPoints(node.inset.bottom),
        pxToPoints(node.inset.top),
      ],
      fill: shapeFill(node.fill),
      line: shapeLine(node.line),
      shadow: shapeShadow(node.shadow),
      rotate: node.rect.rotation || undefined,
    } as never,
  )
}

function addTable(slide: PptxGenJS.Slide, node: SceneTableNode) {
  const rows = node.rows.map((row) =>
    row.map((cell) => ({
      text: textRuns(cell.paragraphs) as never,
      options: {
        colspan: cell.colSpan > 1 ? cell.colSpan : undefined,
        rowspan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
        fill: shapeFill(cell.fill),
      },
    })),
  )

  slide.addTable(
    rows as never,
    {
      ...position(node.rect),
      colW: node.columnWidths.map(pxToInches),
      rowH: node.rowHeights.map(pxToInches),
    } as never,
  )
}

function addNode(pptx: PptxGenJS, slide: PptxGenJS.Slide, node: SceneNode) {
  if (node.kind === 'text') {
    addText(slide, node)
    return
  }

  if (node.kind === 'image' || (node.kind === 'raster' && node.data)) {
    const data = node.kind === 'image' ? node.data : node.data!
    slide.addImage({
      data,
      ...position(node.rect),
      sizing:
        node.kind === 'image' && node.sizing !== 'fill'
          ? {
              type: node.sizing,
              w: pxToInches(node.rect.width),
              h: pxToInches(node.rect.height),
            }
          : undefined,
      altText: node.kind === 'image' ? node.alt || undefined : undefined,
      rotate: node.kind === 'image' ? node.rect.rotation || undefined : undefined,
    } as never)
    return
  }

  if (node.kind === 'table') {
    addTable(slide, node)
    return
  }

  if (node.kind === 'shape') {
    const shapeType =
      node.shape === 'ellipse'
        ? pptx.ShapeType.ellipse
        : node.shape === 'roundRect'
          ? pptx.ShapeType.roundRect
          : pptx.ShapeType.rect

    slide.addShape(shapeType, {
      ...position(node.rect),
      fill: shapeFill(node.fill),
      line: shapeLine(node.line),
      shadow: shapeShadow(node.shadow),
      // PowerPoint takes a corner radius as a fraction of the shorter side.
      rectRadius:
        node.shape === 'roundRect'
          ? Math.min(0.5, node.radius / Math.max(1, Math.min(node.rect.width, node.rect.height)))
          : undefined,
      rotate: node.rect.rotation || undefined,
    } as never)
  }

  // A raster node without pixels means the capture failed; drawing an empty
  // picture would be worse than leaving the region to the slide background.
}

function addSlide(pptx: PptxGenJS, sceneSlide: SceneSlide) {
  const slide = pptx.addSlide()
  const background = shapeFill(sceneSlide.background)
  if (background) slide.background = background

  for (const node of sceneSlide.nodes) addNode(pptx, slide, node)
  if (sceneSlide.notes) slide.addNotes(sceneSlide.notes)
}

export async function generateDeckPptx(scene: DeckScene, title: string): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Ark'
  pptx.company = 'Ark'
  pptx.title = title || 'Untitled Presentation'
  pptx.subject = title || 'Untitled Presentation'

  for (const sceneSlide of scene.slides) addSlide(pptx, sceneSlide)

  const output = await pptx.write({ outputType: 'nodebuffer' })
  if (!ArrayBuffer.isView(output)) {
    throw new Error('PowerPoint generator returned an unexpected output type.')
  }

  return Buffer.from(output.buffer, output.byteOffset, output.byteLength)
}

/**
 * Read the slide parts back out of a generated deck.
 *
 * Shared by the emitter tests and the desktop smoke test, because the assertion
 * that matters is the same in both: the slides must carry real text runs, and a
 * deck of pictures would mean the whole native path silently stopped working.
 */
export async function readPptxSlideXml(pptx: Buffer): Promise<string[]> {
  const { default: JSZip } = await import('jszip')
  const archive = await JSZip.loadAsync(pptx)

  const names = Object.keys(archive.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0))

  return Promise.all(names.map((name) => archive.files[name].async('string')))
}

/** Every `<a:t>` body on a slide, in document order. */
export function readPptxSlideText(slideXml: string): string[] {
  return [...slideXml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1])
}

export async function inspectExportedPptx(pptx: Buffer, expectedSlides = 2) {
  const fail = (detail: string) => ({ ok: false as const, detail })

  if (pptx.subarray(0, 2).toString('ascii') !== 'PK') return fail('Export is not a PPTX archive.')

  const slides = await readPptxSlideXml(pptx)
  if (slides.length !== expectedSlides) {
    return fail(`PPTX has ${slides.length} slides, expected ${expectedSlides}.`)
  }

  for (const [index, slideXml] of slides.entries()) {
    const text = readPptxSlideText(slideXml)
    if (text.length === 0) {
      return fail(`PPTX slide ${index} has no text runs; it exported as pictures.`)
    }
    if (!slideXml.includes('typeface=')) {
      return fail(`PPTX slide ${index} set no typeface.`)
    }
  }

  return { ok: true as const, detail: '' }
}
