import JSZip from 'jszip'

import { DEFAULT_DECK_FONT_IDS } from '@ark/runtime-registry/deck-font-registry.ts'

import { assertPptxBytes } from './detect.ts'
import { PPTX_ENCRYPTED_MESSAGE, PPTX_INVALID_MESSAGE, PptxImportError } from './errors.ts'
import type { ImportedObject, ImportedPresentation, ImportedSlide } from './types.ts'
import {
  attrNS,
  descendant,
  directChildren,
  firstChild,
  parseXml,
  rId,
  textContent,
} from './xml.ts'
import {
  CSS_PIXELS_PER_INCH,
  DEFAULT_SLIDE_CX,
  DEFAULT_SLIDE_CY,
  EMU_PER_INCH,
  loadRels,
  mediaFromRel,
  parseTheme,
  placeholderType,
  readEmu,
  readFill,
  readParagraphs,
  readText,
  resolveFontId,
  type Relationship,
  type ZipContext,
} from './parse-ooxml/context.ts'
import { parseTree } from './parse-ooxml/shapes.ts'

export async function parseNotes(zip: JSZip, rels: Relationship[]) {
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
export async function parseBackground(cSld: Element, ctx: ZipContext, rels: Relationship[]) {
  const bg = firstChild(cSld, 'bg') ?? descendant(cSld, 'bg')
  const bgPr = descendant(bg, 'bgPr') ?? bg
  const color = readFill(bgPr, ctx.theme) ?? ctx.theme.colors.lt1 ?? '#FFFFFF'
  const blip = descendant(bgPr, 'blip')
  const backgroundImage = await mediaFromRel(ctx.zip, rels, attrNS(blip, 'embed'))
  return { backgroundColor: color, backgroundImage }
}

export async function parseSlidePart(
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

export function readCoreTitle(xml: string | null) {
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
