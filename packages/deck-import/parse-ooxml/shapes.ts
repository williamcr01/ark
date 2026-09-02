import { DEFAULT_DECK_FONT_IDS, getDeckFont } from '@ark/runtime-registry/deck-font-registry.ts'
import {
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck/document/metadata.ts'
import type { EmuRect, ImportedObject, PxRect } from '../types.ts'
import { attr, attrNS, descendant, firstChild, rId } from '../xml.ts'
import { parseChartXml } from './charts.ts'
import {
  BASIC_SHAPES,
  CHART_NS_HINT,
  DIAGRAM_NS_HINT,
  TABLE_NS_HINT,
  emuToPxRect,
  hasComplexEffects,
  isComplexGroup,
  mapGroupRect,
  mediaFromRel,
  paragraphsHaveText,
  placeholderType,
  readFill,
  readParagraphs,
  readText,
  readXfrm,
  resolveColor,
  type Relationship,
  type ZipContext,
} from './context.ts'

export function toPx(rect: EmuRect | null, ctx: ZipContext): PxRect | null {
  if (!rect || (rect.width <= 0 && rect.height <= 0)) return null
  return emuToPxRect(rect, ctx.slideCx, ctx.slideCy)
}

export function fallbackSlideRect(): PxRect {
  return {
    x: 0,
    y: 0,
    width: ARK_SLIDE_REFERENCE_WIDTH,
    height: ARK_SLIDE_REFERENCE_HEIGHT,
  }
}

export async function parseShape(
  sp: Element,
  ctx: ZipContext,
  group: Element | null,
): Promise<ImportedObject | null> {
  const spPr = firstChild(sp, 'spPr') ?? descendant(sp, 'spPr')
  let rect = readXfrm(descendant(spPr, 'xfrm') ?? descendant(sp, 'xfrm'))
  if (rect && group) rect = mapGroupRect(rect, group)
  const fill = readFill(spPr, ctx.theme)
  const ph = placeholderType(sp)
  const px = toPx(rect, ctx)
  if (!px) {
    return {
      kind: 'unmappable',
      rect: fallbackSlideRect(),
      reason: ph ? 'placeholder-geometry' : 'missing-xfrm',
      fill,
      media: null,
    }
  }

  const geom = attr(descendant(spPr, 'prstGeom'), 'prst') ?? 'rect'
  const stroke = resolveColor(descendant(spPr, 'ln'), ctx.theme)
  const effects = hasComplexEffects(spPr)
  const txBody = firstChild(sp, 'txBody') ?? descendant(sp, 'txBody')
  const paragraphs = readParagraphs(txBody, ctx.theme, DEFAULT_DECK_FONT_IDS.body)
  const hasText = paragraphsHaveText(paragraphs)
  const fontId =
    ph === 'title' || ph === 'ctrTitle' ? DEFAULT_DECK_FONT_IDS.display : DEFAULT_DECK_FONT_IDS.body

  if (effects && !hasText) {
    return { kind: 'unmappable', rect: px, reason: 'effects', fill, media: null }
  }

  if (hasText) {
    const first = paragraphs[0]?.runs[0]
    return {
      kind: 'text',
      rect: px,
      paragraphs,
      fill: fill && fill.toUpperCase() !== ctx.theme.colors.lt1?.toUpperCase() ? fill : null,
      color: first?.color ?? ctx.theme.colors.dk1 ?? '#111827',
      fontStack: first?.fontStack ?? getDeckFont(fontId)!.cssStack,
      valign:
        attr(descendant(txBody, 'bodyPr'), 'anchor') === 'ctr'
          ? 'middle'
          : attr(descendant(txBody, 'bodyPr'), 'anchor') === 'b'
            ? 'bottom'
            : 'top',
    }
  }

  if (BASIC_SHAPES.has(geom) && !effects) {
    const shape =
      geom === 'circle'
        ? 'ellipse'
        : geom === 'roundRect'
          ? 'roundRect'
          : geom === 'ellipse'
            ? 'ellipse'
            : 'rect'
    return { kind: 'shape', rect: px, shape, fill, stroke }
  }

  return { kind: 'unmappable', rect: px, reason: geom, fill, media: null }
}

export async function parsePicture(
  pic: Element,
  ctx: ZipContext,
  rels: Relationship[],
  group: Element | null,
): Promise<ImportedObject | null> {
  const spPr = firstChild(pic, 'spPr') ?? descendant(pic, 'spPr')
  let rect = readXfrm(descendant(spPr, 'xfrm') ?? descendant(pic, 'xfrm'))
  if (rect && group) rect = mapGroupRect(rect, group)
  const px = toPx(rect, ctx)
  if (!px) return null
  const blip = descendant(pic, 'blip')
  const media = await mediaFromRel(ctx.zip, rels, attrNS(blip, 'embed'))
  if (!media || media.mediaType === 'application/octet-stream') {
    return { kind: 'unmappable', rect: px, reason: 'picture', fill: null, media: null }
  }
  const name = attr(descendant(pic, 'cNvPr'), 'name') || 'Image'
  return { kind: 'image', rect: px, media, alt: name }
}

export async function parseGraphicFrame(
  frame: Element,
  ctx: ZipContext,
  rels: Relationship[],
  group: Element | null,
): Promise<ImportedObject | null> {
  const xfrm = descendant(frame, 'xfrm')
  let rect = readXfrm(xfrm)
  if (rect && group) rect = mapGroupRect(rect, group)
  const px = toPx(rect, ctx)
  if (!px) return null
  const graphicData = descendant(frame, 'graphicData')
  const uri = (attr(graphicData, 'uri') ?? '').toLowerCase()
  if (uri.includes(CHART_NS_HINT) || descendant(frame, 'chart')) {
    const chartEl = descendant(frame, 'chart')
    const relId = rId(chartEl)
    const rel = rels.find((item) => item.id === relId)
    const xml = rel ? await readText(ctx.zip, rel.target) : null
    const config = xml ? parseChartXml(xml, ctx.theme) : null
    return { kind: 'chart', rect: px, config }
  }
  if (uri.includes(DIAGRAM_NS_HINT) || uri.includes('smartart') || uri.includes(TABLE_NS_HINT)) {
    return {
      kind: 'unmappable',
      rect: px,
      reason: uri.includes(TABLE_NS_HINT) ? 'table' : 'smartart',
      fill: null,
      media: null,
    }
  }
  return { kind: 'unmappable', rect: px, reason: 'graphic', fill: null, media: null }
}

export async function parseTree(
  parent: Element,
  ctx: ZipContext,
  rels: Relationship[],
  group: Element | null,
  objects: ImportedObject[],
) {
  for (const child of parent.children) {
    const name = child.localName
    if (name === 'sp' || name === 'cxnSp') {
      const parsed = await parseShape(child, ctx, group)
      if (parsed) objects.push(parsed)
    } else if (name === 'pic') {
      const parsed = await parsePicture(child, ctx, rels, group)
      if (parsed) objects.push(parsed)
    } else if (name === 'graphicFrame') {
      const parsed = await parseGraphicFrame(child, ctx, rels, group)
      if (parsed) objects.push(parsed)
    } else if (name === 'grpSp') {
      if (isComplexGroup(child)) {
        const rect = readXfrm(descendant(firstChild(child, 'grpSpPr'), 'xfrm'))
        const px = toPx(rect, ctx)
        if (px)
          objects.push({ kind: 'unmappable', rect: px, reason: 'group', fill: null, media: null })
      } else {
        await parseTree(child, ctx, rels, child, objects)
      }
    }
  }
}
