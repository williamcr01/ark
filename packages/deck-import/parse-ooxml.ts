import JSZip from 'jszip'

import {
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck/document/metadata.ts'
import {
  DEFAULT_DECK_FONT_IDS,
  getDeckFont,
  getDeckFontByPptxTypeface,
} from '@ark/runtime-registry/deck-font-registry.ts'

import { assertPptxBytes } from './detect.ts'
import { PPTX_ENCRYPTED_MESSAGE, PPTX_INVALID_MESSAGE, PptxImportError } from './errors.ts'
import {
  type ChartJsConfig,
  type EmuRect,
  type ImportedObject,
  type ImportedParagraph,
  type ImportedPresentation,
  type ImportedSlide,
  type ImportedTextRun,
  type MediaBlob,
  type PxRect,
} from './types.ts'
import {
  attr,
  attrNS,
  descendant,
  directChildren,
  firstChild,
  parseXml,
  rId,
  textContent,
} from './xml.ts'

const EMU_PER_INCH = 914_400
const CSS_PIXELS_PER_INCH = 96
const DEFAULT_SLIDE_CX = 12_192_000
const DEFAULT_SLIDE_CY = 6_858_000

const CHART_NS_HINT = '/drawingml/2006/chart'
const DIAGRAM_NS_HINT = 'diagram'
const TABLE_NS_HINT = '/drawingml/2006/table'

const BASIC_SHAPES = new Set(['rect', 'roundRect', 'ellipse', 'circle'])

type Relationship = { id: string; type: string; target: string }

type Theme = {
  colors: Record<string, string>
  majorFont: string | null
  minorFont: string | null
}

type ZipContext = {
  zip: JSZip
  slideCx: number
  slideCy: number
  theme: Theme
}

function resolveFontId(typeface: string | null | undefined, fallbackId: string) {
  return getDeckFontByPptxTypeface(typeface)?.id ?? fallbackId
}

function resolveFontStack(typeface: string | null | undefined, fallbackId: string) {
  return (getDeckFontByPptxTypeface(typeface) ?? getDeckFont(fallbackId))!.cssStack
}

function zipPath(fromPart: string, target: string) {
  const normalized = target.replaceAll('\\', '/')
  if (normalized.startsWith('/')) return normalized.replace(/^\/+/, '')
  const segments = fromPart.split('/').slice(0, -1)
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}

async function readText(zip: JSZip, path: string) {
  const file = zip.file(path)
  if (!file) return null
  return file.async('string')
}

async function readBytes(zip: JSZip, path: string) {
  const file = zip.file(path)
  if (!file) return null
  return file.async('uint8array')
}

function parseRels(xml: string, fromPart: string): Relationship[] {
  const doc = parseXml(xml)
  return [...doc.getElementsByTagName('*')]
    .filter((el) => el.localName === 'Relationship')
    .map((el) => ({
      id: el.getAttribute('Id') ?? '',
      type: el.getAttribute('Type') ?? '',
      target: zipPath(fromPart, el.getAttribute('Target') ?? ''),
    }))
    .filter((rel) => rel.id && rel.target)
}

function relsPartFor(partPath: string) {
  const segments = partPath.split('/')
  const file = segments.pop()
  return `${segments.join('/')}/_rels/${file}.rels`
}

async function loadRels(zip: JSZip, partPath: string) {
  const xml = await readText(zip, relsPartFor(partPath))
  return xml ? parseRels(xml, partPath) : []
}

function mediaTypeFor(path: string) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  return 'application/octet-stream'
}

function emuToPxRect(rect: EmuRect, slideCx: number, slideCy: number): PxRect {
  const width = slideCx || DEFAULT_SLIDE_CX
  const height = slideCy || DEFAULT_SLIDE_CY
  return {
    x: (rect.x / width) * ARK_SLIDE_REFERENCE_WIDTH,
    y: (rect.y / height) * ARK_SLIDE_REFERENCE_HEIGHT,
    width: (rect.width / width) * ARK_SLIDE_REFERENCE_WIDTH,
    height: (rect.height / height) * ARK_SLIDE_REFERENCE_HEIGHT,
    ...(rect.rotation ? { rotation: rect.rotation } : {}),
  }
}

function readEmu(el: Element | null, name: string) {
  const value = attr(el, name)
  if (!value) return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function readXfrm(xfrm: Element | null): EmuRect | null {
  if (!xfrm) return null
  const off = descendant(xfrm, 'off')
  const ext = descendant(xfrm, 'ext')
  const rot = attr(xfrm, 'rot')
  const rotation = rot ? Number.parseInt(rot, 10) / 60_000 : 0
  return {
    x: readEmu(off, 'x'),
    y: readEmu(off, 'y'),
    width: readEmu(ext, 'cx'),
    height: readEmu(ext, 'cy'),
    ...(rotation ? { rotation } : {}),
  }
}

function mapGroupRect(child: EmuRect, group: Element): EmuRect {
  const xfrm = descendant(firstChild(group, 'grpSpPr') ?? group, 'xfrm')
  if (!xfrm) return child
  const off = descendant(xfrm, 'off')
  const ext = descendant(xfrm, 'ext')
  const chOff = descendant(xfrm, 'chOff')
  const chExt = descendant(xfrm, 'chExt')
  const groupX = readEmu(off, 'x')
  const groupY = readEmu(off, 'y')
  const groupW = readEmu(ext, 'cx') || 1
  const groupH = readEmu(ext, 'cy') || 1
  const childOffX = readEmu(chOff, 'x')
  const childOffY = readEmu(chOff, 'y')
  const childExtX = readEmu(chExt, 'cx') || groupW
  const childExtY = readEmu(chExt, 'cy') || groupH
  return {
    x: groupX + ((child.x - childOffX) / childExtX) * groupW,
    y: groupY + ((child.y - childOffY) / childExtY) * groupH,
    width: (child.width / childExtX) * groupW,
    height: (child.height / childExtY) * groupH,
    rotation: child.rotation,
  }
}

function hexFromRgb(value: string) {
  const hex = value.replace('#', '').trim()
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}`
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.slice(2).toUpperCase()}`
  return null
}

function mixToward(hex: string, target: number, amount: number) {
  const raw = hex.replace('#', '')
  const mix = Math.max(0, Math.min(1, amount))
  const channels = [0, 2, 4].map((start) => {
    const value = Number.parseInt(raw.slice(start, start + 2), 16)
    return Math.round(value + (target - value) * mix)
      .toString(16)
      .padStart(2, '0')
  })
  return `#${channels.join('').toUpperCase()}`
}

function applyColorTransforms(hex: string, transforms: Element | null) {
  if (!transforms) return hex
  let current = hex
  for (const child of transforms.children) {
    const name = child.localName
    const value = Number.parseInt(attr(child, 'val') ?? '0', 10)
    const amount = Number.isFinite(value) ? Math.abs(value) / 100_000 : 0
    if (name === 'tint') current = mixToward(current, 255, amount)
    else if (name === 'shade') current = mixToward(current, 0, amount)
    else if (name === 'lumMod') {
      const factor = Number.isFinite(value) ? value / 100_000 : 1
      current = mixToward(current, 0, 1 - factor)
    } else if (name === 'lumOff') current = mixToward(current, 255, amount)
  }
  return current
}

function resolveColor(el: Element | null | undefined, theme: Theme): string | null {
  if (!el) return null
  const srgb = descendant(el, 'srgbClr')
  if (srgb) {
    const hex = hexFromRgb(attr(srgb, 'val') ?? '')
    return hex ? applyColorTransforms(hex, srgb) : null
  }
  const sys = descendant(el, 'sysClr')
  if (sys) {
    const hex = hexFromRgb(attr(sys, 'lastClr') ?? '')
    return hex ? applyColorTransforms(hex, sys) : null
  }
  const scheme = descendant(el, 'schemeClr')
  if (scheme) {
    const key = (attr(scheme, 'val') ?? '').toLowerCase()
    const mapped =
      theme.colors[key] ??
      theme.colors[
        key.replace('bg1', 'lt1').replace('bg2', 'lt2').replace('tx1', 'dk1').replace('tx2', 'dk2')
      ]
    return mapped ? applyColorTransforms(mapped, scheme) : null
  }
  return null
}

function parseTheme(xml: string): Theme {
  const doc = parseXml(xml)
  const colors: Record<string, string> = {
    dk1: '#000000',
    lt1: '#FFFFFF',
    dk2: '#44546A',
    lt2: '#E7E6E6',
    accent1: '#4472C4',
    accent2: '#ED7D31',
    accent3: '#A5A5A5',
    accent4: '#FFC000',
    accent5: '#5B9BD5',
    accent6: '#70AD47',
    hlink: '#0563C1',
    folHlink: '#954F72',
  }
  const scheme = descendant(doc, 'clrScheme')
  if (scheme) {
    for (const child of scheme.children) {
      const hex = resolveColor(child, { colors, majorFont: null, minorFont: null })
      if (hex) colors[child.localName] = hex
    }
  }
  return {
    colors,
    majorFont: attr(descendant(descendant(doc, 'majorFont'), 'latin'), 'typeface'),
    minorFont: attr(descendant(descendant(doc, 'minorFont'), 'latin'), 'typeface'),
  }
}

function hundredthsOfPointToPx(sz: string | null) {
  if (!sz) return null
  const parsed = Number.parseInt(sz, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return (parsed / 100) * (CSS_PIXELS_PER_INCH / 72)
}

function readFill(container: Element | null, theme: Theme) {
  if (!container) return null
  if (firstChild(container, 'noFill')) return null
  const solid = firstChild(container, 'solidFill')
  return solid ? resolveColor(solid, theme) : null
}

function hasComplexEffects(container: Element | null) {
  const effects = descendant(container, 'effectLst')
  if (!effects) return false
  return [...effects.children].some((child) => child.localName !== 'extLst')
}

function isComplexGroup(group: Element) {
  return descendant(group, 'graphicFrame') !== null || directChildren(group, 'grpSp').length > 0
}

function placeholderType(sp: Element) {
  return attr(descendant(sp, 'ph'), 'type')
}

function readParagraphs(
  txBody: Element | null,
  theme: Theme,
  fallbackId: string,
): ImportedParagraph[] {
  if (!txBody) return []
  const paragraphs: ImportedParagraph[] = []
  for (const paragraph of directChildren(txBody, 'p')) {
    const algn = attr(descendant(paragraph, 'pPr') ?? firstChild(paragraph, 'pPr'), 'algn')
    const align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : 'left'
    const runs: ImportedTextRun[] = []
    for (const child of paragraph.children) {
      const name = child.localName
      if (name === 'br') {
        const last = runs.at(-1)
        if (last) last.text += '\n'
        else {
          runs.push({
            text: '\n',
            bold: false,
            italic: false,
            underline: false,
            fontSizePx: null,
            color: null,
            fontStack: null,
          })
        }
        continue
      }
      if (name !== 'r' && name !== 'fld') continue
      const text = descendant(child, 't')?.textContent ?? ''
      if (!text) continue
      const rPr = descendant(child, 'rPr') ?? firstChild(child, 'rPr')
      const latin = attr(descendant(rPr, 'latin'), 'typeface')
      runs.push({
        text,
        bold: attr(rPr, 'b') === '1',
        italic: attr(rPr, 'i') === '1',
        underline: Boolean(attr(rPr, 'u') && attr(rPr, 'u') !== 'none'),
        fontSizePx: hundredthsOfPointToPx(attr(rPr, 'sz')),
        color: readFill(rPr, theme),
        fontStack: latin ? resolveFontStack(latin, fallbackId) : null,
      })
    }
    if (runs.length > 0) paragraphs.push({ align, runs })
  }
  return paragraphs
}

function paragraphsHaveText(paragraphs: ImportedParagraph[]) {
  return paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim()))
}

async function mediaFromRel(
  zip: JSZip,
  rels: Relationship[],
  embedId: string | null,
): Promise<MediaBlob | null> {
  if (!embedId) return null
  const rel = rels.find((item) => item.id === embedId)
  if (!rel) return null
  const bytes = await readBytes(zip, rel.target)
  if (!bytes || bytes.byteLength === 0) return null
  return { partPath: rel.target, mediaType: mediaTypeFor(rel.target), bytes }
}

const CHART_TYPE_MAP: Record<string, ChartJsConfig['type']> = {
  barChart: 'bar',
  bar3DChart: 'bar',
  lineChart: 'line',
  line3DChart: 'line',
  pieChart: 'pie',
  pie3DChart: 'pie',
  doughnutChart: 'doughnut',
  ofPieChart: 'pie',
  radarChart: 'radar',
  scatterChart: 'scatter',
}

function parseNumericPoint(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.toUpperCase() === '#N/A') return null
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function readCachePoints(container: Element | null) {
  const cache = descendant(container, 'numCache') ?? descendant(container, 'strCache')
  const literals = descendant(container, 'numLit') ?? descendant(container, 'strLit')
  const root = cache ?? literals
  if (!root) return null
  const points = [...root.getElementsByTagName('*')].filter((el) => el.localName === 'pt')
  const byIdx = new Map<number, string>()
  for (const point of points) {
    const idx = Number.parseInt(attr(point, 'idx') ?? '0', 10)
    byIdx.set(Number.isFinite(idx) ? idx : 0, textContent(descendant(point, 'v') ?? point))
  }
  const counted = Number.parseInt(attr(descendant(root, 'ptCount'), 'val') ?? '', 10)
  const length =
    Number.isFinite(counted) && counted >= 0
      ? counted
      : byIdx.size === 0
        ? 0
        : Math.max(...byIdx.keys()) + 1
  const values: string[] = []
  for (let i = 0; i < length; i++) values.push(byIdx.get(i) ?? '')
  return values
}

function scatterPoints(xs: string[] | null, ys: string[]) {
  const count = Math.max(xs?.length ?? 0, ys.length)
  const data: Array<{ x: number; y: number }> = []
  for (let i = 0; i < count; i++) {
    const y = parseNumericPoint(ys[i] ?? '')
    if (y === null) continue
    const rawX = xs?.[i]
    const x = rawX !== undefined && rawX !== '' ? parseNumericPoint(rawX) : i
    if (x === null) continue
    data.push({ x, y })
  }
  return data
}

function parseChartXml(xml: string, theme: Theme): ChartJsConfig | null {
  const doc = parseXml(xml)
  const plot = descendant(doc, 'plotArea')
  if (!plot) return null
  const chartEl = [...plot.children].find((child) => CHART_TYPE_MAP[child.localName])
  if (!chartEl) return null
  const type = CHART_TYPE_MAP[chartEl.localName]
  if (!type) return null

  const series = directChildren(chartEl, 'ser')
  if (series.length === 0) return null

  const firstCats = readCachePoints(descendant(series[0], 'cat'))

  const datasets: ChartJsConfig['data']['datasets'] = []
  const palette = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map(
    (key) => theme.colors[key] ?? '#4472C4',
  )

  for (const [index, ser] of series.entries()) {
    const values = readCachePoints(descendant(ser, 'val') ?? descendant(ser, 'yVal'))
    if (!values) return null
    const numbers = values.map((value) => parseNumericPoint(value))
    const label = textContent(descendant(descendant(ser, 'tx'), 'v')) || `Series ${index + 1}`
    const color = resolveColor(descendant(ser, 'spPr'), theme) ?? palette[index % palette.length]
    const data =
      type === 'scatter' ? scatterPoints(readCachePoints(descendant(ser, 'xVal')), values) : numbers
    datasets.push({
      label,
      data,
      backgroundColor:
        type === 'pie' || type === 'doughnut' ? palette.slice(0, data.length) : color,
      borderColor: color,
    })
  }

  if (datasets.length === 0) return null

  return {
    type,
    data: {
      labels:
        firstCats && firstCats.length > 0
          ? firstCats
          : datasets[0]!.data.map((_, index) => String(index + 1)),
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { labels: { color: theme.colors.dk1 ?? '#111827' } } },
    },
  }
}

async function parseNotes(zip: JSZip, rels: Relationship[]) {
  const rel = rels.find((item) => item.type.includes('/notesSlide'))
  if (!rel) return null
  const xml = await readText(zip, rel.target)
  if (!xml) return null
  const doc = parseXml(xml)
  const shapes = [...doc.getElementsByTagName('*')].filter((el) => el.localName === 'sp')
  for (const shape of shapes) {
    const type = placeholderType(shape)
    if (type === 'sldNum' || type === 'hdr' || type === 'ftr') continue
    if (type === 'body' || !type) {
      const paragraphs = readParagraphs(
        descendant(shape, 'txBody'),
        {
          colors: {},
          majorFont: null,
          minorFont: null,
        },
        DEFAULT_DECK_FONT_IDS.body,
      )
      const text = paragraphs
        .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
        .join('\n')
        .trim()
      if (text) return text
    }
  }
  return null
}

function toPx(rect: EmuRect | null, ctx: ZipContext): PxRect | null {
  if (!rect || (rect.width <= 0 && rect.height <= 0)) return null
  return emuToPxRect(rect, ctx.slideCx, ctx.slideCy)
}

function fallbackSlideRect(): PxRect {
  return {
    x: 0,
    y: 0,
    width: ARK_SLIDE_REFERENCE_WIDTH,
    height: ARK_SLIDE_REFERENCE_HEIGHT,
  }
}

async function parseShape(
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

async function parsePicture(
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

async function parseGraphicFrame(
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

async function parseTree(
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

async function parseBackground(cSld: Element, ctx: ZipContext, rels: Relationship[]) {
  const bg = firstChild(cSld, 'bg') ?? descendant(cSld, 'bg')
  const bgPr = descendant(bg, 'bgPr') ?? bg
  const color = readFill(bgPr, ctx.theme) ?? ctx.theme.colors.lt1 ?? '#FFFFFF'
  const blip = descendant(bgPr, 'blip')
  const backgroundImage = await mediaFromRel(ctx.zip, rels, attrNS(blip, 'embed'))
  return { backgroundColor: color, backgroundImage }
}

async function parseSlidePart(
  ctx: ZipContext,
  partPath: string,
  index: number,
): Promise<ImportedSlide> {
  const xml = await readText(ctx.zip, partPath)
  if (!xml) {
    return {
      index,
      notes: null,
      backgroundColor: ctx.theme.colors.lt1 ?? '#FFFFFF',
      backgroundImage: null,
      objects: [],
    }
  }
  const doc = parseXml(xml)
  const rels = await loadRels(ctx.zip, partPath)
  const cSld = descendant(doc, 'cSld') ?? doc.documentElement
  const tree = descendant(cSld, 'spTree')
  const background = await parseBackground(cSld, ctx, rels)
  const objects: ImportedObject[] = []
  if (tree) await parseTree(tree, ctx, rels, null, objects)
  const notes = await parseNotes(ctx.zip, rels)
  return { index, notes, ...background, objects }
}

function readCoreTitle(xml: string | null) {
  if (!xml) return null
  const doc = parseXml(xml)
  const title = textContent(descendant(doc, 'title') ?? descendant(doc, 'dc:title'))
  return title || null
}

export async function parsePptxArchive(
  bytes: Uint8Array,
  filename?: string | null,
): Promise<ImportedPresentation> {
  assertPptxBytes(bytes, filename)
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new PptxImportError(PPTX_INVALID_MESSAGE, 'pptx_invalid')
  }

  if (zip.file('EncryptionInfo') || zip.file('EncryptedPackage')) {
    throw new PptxImportError(PPTX_ENCRYPTED_MESSAGE, 'pptx_encrypted')
  }

  const presentationXml = await readText(zip, 'ppt/presentation.xml')
  if (!presentationXml) {
    throw new PptxImportError(PPTX_INVALID_MESSAGE, 'pptx_invalid')
  }

  const presentation = parseXml(presentationXml)
  const rels = await loadRels(zip, 'ppt/presentation.xml')
  const sldSz = descendant(presentation, 'sldSz')
  const slideCx = readEmu(sldSz, 'cx') || DEFAULT_SLIDE_CX
  const slideCy = readEmu(sldSz, 'cy') || DEFAULT_SLIDE_CY

  const themeRel = rels.find((rel) => rel.type.endsWith('/theme'))
  const themeXml = themeRel ? await readText(zip, themeRel.target) : null
  const theme = themeXml
    ? parseTheme(themeXml)
    : parseTheme('<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>')

  const slideRels = rels.filter((rel) => rel.type.endsWith('/slide'))
  const sldIds = descendant(presentation, 'sldIdLst')
    ? directChildren(descendant(presentation, 'sldIdLst')!, 'sldId')
    : []
  const ordered = (sldIds.length > 0 ? sldIds : slideRels.map((_, index) => ({ index }))).map(
    (el, index) => {
      if ('getAttribute' in el) {
        const id = rId(el as Element)
        const rel = slideRels.find((item) => item.id === id)
        return rel?.target ?? slideRels[index]?.target
      }
      return slideRels[index]?.target
    },
  )

  const unique = ordered.filter((path): path is string => Boolean(path))
  if (unique.length === 0) {
    throw new PptxImportError('That PowerPoint file has no slides to import.', 'pptx_invalid')
  }

  const ctx: ZipContext = { zip, slideCx, slideCy, theme }
  const slides: ImportedSlide[] = []
  for (const [index, partPath] of unique.entries()) {
    slides.push(await parseSlidePart(ctx, partPath, index))
  }

  const core = await readText(zip, 'docProps/core.xml')
  const fileTitle = filename?.replace(/\.pptx$/i, '').trim()
  const title = readCoreTitle(core) || fileTitle || 'Imported presentation'

  return {
    title,
    slides,
    displayFontId: resolveFontId(theme.majorFont, DEFAULT_DECK_FONT_IDS.display),
    bodyFontId: resolveFontId(theme.minorFont, DEFAULT_DECK_FONT_IDS.body),
  }
}

export { EMU_PER_INCH, CSS_PIXELS_PER_INCH }
