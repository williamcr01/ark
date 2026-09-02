import JSZip from 'jszip'

import {
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck/document/metadata.ts'
import { getDeckFont, getDeckFontByPptxTypeface } from '@ark/runtime-registry/deck-font-registry.ts'

import {
  type EmuRect,
  type ImportedParagraph,
  type ImportedTextRun,
  type MediaBlob,
  type PxRect,
} from '../types.ts'
import { attr, descendant, directChildren, firstChild, parseXml } from '../xml.ts'

export const EMU_PER_INCH = 914_400
export const CSS_PIXELS_PER_INCH = 96
export const DEFAULT_SLIDE_CX = 12_192_000
export const DEFAULT_SLIDE_CY = 6_858_000

export const CHART_NS_HINT = '/drawingml/2006/chart'
export const DIAGRAM_NS_HINT = 'diagram'
export const TABLE_NS_HINT = '/drawingml/2006/table'

export const BASIC_SHAPES = new Set(['rect', 'roundRect', 'ellipse', 'circle'])

export type Relationship = { id: string; type: string; target: string }

export type Theme = {
  colors: Record<string, string>
  majorFont: string | null
  minorFont: string | null
}

export type ZipContext = {
  zip: JSZip
  slideCx: number
  slideCy: number
  theme: Theme
}

export function resolveFontId(typeface: string | null | undefined, fallbackId: string) {
  return getDeckFontByPptxTypeface(typeface)?.id ?? fallbackId
}

export function resolveFontStack(typeface: string | null | undefined, fallbackId: string) {
  return (getDeckFontByPptxTypeface(typeface) ?? getDeckFont(fallbackId))!.cssStack
}

export function zipPath(fromPart: string, target: string) {
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

export async function readText(zip: JSZip, path: string) {
  const file = zip.file(path)
  if (!file) return null
  return file.async('string')
}

export async function readBytes(zip: JSZip, path: string) {
  const file = zip.file(path)
  if (!file) return null
  return file.async('uint8array')
}

export function parseRels(xml: string, fromPart: string): Relationship[] {
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

export function relsPartFor(partPath: string) {
  const segments = partPath.split('/')
  const file = segments.pop()
  return `${segments.join('/')}/_rels/${file}.rels`
}

export async function loadRels(zip: JSZip, partPath: string) {
  const xml = await readText(zip, relsPartFor(partPath))
  return xml ? parseRels(xml, partPath) : []
}

export function mediaTypeFor(path: string) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  return 'application/octet-stream'
}

export function emuToPxRect(rect: EmuRect, slideCx: number, slideCy: number): PxRect {
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

export function readEmu(el: Element | null, name: string) {
  const value = attr(el, name)
  if (!value) return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export function readXfrm(xfrm: Element | null): EmuRect | null {
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

export function mapGroupRect(child: EmuRect, group: Element): EmuRect {
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

export function hexFromRgb(value: string) {
  const hex = value.replace('#', '').trim()
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}`
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.slice(2).toUpperCase()}`
  return null
}

export function mixToward(hex: string, target: number, amount: number) {
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

export function applyColorTransforms(hex: string, transforms: Element | null) {
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

export function resolveColor(el: Element | null | undefined, theme: Theme): string | null {
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

export function parseTheme(xml: string): Theme {
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

export function hundredthsOfPointToPx(sz: string | null) {
  if (!sz) return null
  const parsed = Number.parseInt(sz, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return (parsed / 100) * (CSS_PIXELS_PER_INCH / 72)
}

export function readFill(container: Element | null, theme: Theme) {
  if (!container) return null
  if (firstChild(container, 'noFill')) return null
  const solid = firstChild(container, 'solidFill')
  return solid ? resolveColor(solid, theme) : null
}

export function hasComplexEffects(container: Element | null) {
  const effects = descendant(container, 'effectLst')
  if (!effects) return false
  return [...effects.children].some((child) => child.localName !== 'extLst')
}

export function isComplexGroup(group: Element) {
  return descendant(group, 'graphicFrame') !== null || directChildren(group, 'grpSp').length > 0
}

export function placeholderType(sp: Element) {
  return attr(descendant(sp, 'ph'), 'type')
}

export function readParagraphs(
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

export function paragraphsHaveText(paragraphs: ImportedParagraph[]) {
  return paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim()))
}

export async function mediaFromRel(
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
