/**
 * The scene model: what one slide looks like, expressed in shapes PowerPoint can
 * rebuild natively.
 *
 * Geometry is CSS pixels against the deck's 1280x720 reference frame. That frame
 * is exactly 13.333in x 7.5in at 96dpi - PowerPoint's own widescreen slide - so a
 * pixel converts to 9525 EMU with no rounding, and nothing downstream has to
 * carry a scale factor.
 *
 * The model is deliberately narrow: it holds only what OOXML can express. Where a
 * deck uses CSS with no equivalent, the walk emits a `raster` node marking the
 * region to flatten instead, so one unrepresentable element degrades itself and
 * leaves the rest of the slide editable.
 */

import {
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck/document/metadata.ts'

/** CSS reference pixels per inch, fixed by the CSS spec. */
export const CSS_PIXELS_PER_INCH = 96
/** PostScript points per inch. */
export const POINTS_PER_INCH = 72
/** English Metric Units per inch, fixed by OOXML. */
export const EMU_PER_INCH = 914_400

export const SCENE_FRAME_WIDTH = ARK_SLIDE_REFERENCE_WIDTH
export const SCENE_FRAME_HEIGHT = ARK_SLIDE_REFERENCE_HEIGHT

export function pxToInches(px: number) {
  return px / CSS_PIXELS_PER_INCH
}

export function pxToPoints(px: number) {
  return (px * POINTS_PER_INCH) / CSS_PIXELS_PER_INCH
}

/** Exact by construction: 96 px/inch into 914400 EMU/inch is 9525 EMU per pixel. */
export function pxToEmu(px: number) {
  return Math.round((px * EMU_PER_INCH) / CSS_PIXELS_PER_INCH)
}

/** CSS px, relative to the top-left of the slide frame. */
export type SceneRect = {
  x: number
  y: number
  width: number
  height: number
  /** Clockwise degrees. Absent or 0 for the overwhelming majority of elements. */
  rotation?: number
}

/**
 * Axis-aligned bounds of a (possibly rotated) scene rect.
 *
 * `readRect` stores the unrotated box plus an angle, which is what PowerPoint
 * wants for native shapes. A page capture is already rotated, so a crop has to
 * use this larger box or it clips the corners.
 */
export function axisAlignedBounds(rect: SceneRect): SceneRect {
  const rotation = rect.rotation
  if (!rotation) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }

  const radians = (rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  const width = rect.width * cos + rect.height * sin
  const height = rect.width * sin + rect.height * cos
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2

  return { x: centerX - width / 2, y: centerY - height / 2, width, height }
}

/** Visible intersection with the slide frame. Overflow is clipped, not shifted. */
export function clampRect(rect: SceneRect): SceneRect {
  const x = Math.max(0, rect.x)
  const y = Math.max(0, rect.y)
  const right = Math.min(SCENE_FRAME_WIDTH, rect.x + rect.width)
  const bottom = Math.min(SCENE_FRAME_HEIGHT, rect.y + rect.height)

  return {
    ...rect,
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  }
}

/**
 * Integer crop box for `NativeImage.crop`: the on-slide AABB, rounded, with
 * rotation stripped so the picture is placed where the pixels already are.
 */
export function sceneCaptureRect(rect: SceneRect): SceneRect {
  const clamped = clampRect(axisAlignedBounds(rect))
  const x = Math.round(clamped.x)
  const y = Math.round(clamped.y)
  const width = Math.max(0, Math.min(Math.round(clamped.width), SCENE_FRAME_WIDTH - x))
  const height = Math.max(0, Math.min(Math.round(clamped.height), SCENE_FRAME_HEIGHT - y))

  return { x, y, width, height }
}

/** Six uppercase hex digits, no leading `#`, matching OOXML's `srgbClr`. */
export type SceneColor = string

export type SceneGradientStop = {
  color: SceneColor
  /** 0-100 along the gradient line. */
  position: number
  alpha: number
}

export type SceneFill =
  | { type: 'none' }
  | { type: 'solid'; color: SceneColor; alpha: number }
  | { type: 'gradient'; angle: number; stops: SceneGradientStop[] }

export type SceneLineDash = 'solid' | 'dash' | 'dot'

export type SceneLine = {
  color: SceneColor
  /** CSS px. */
  width: number
  dash: SceneLineDash
  alpha: number
}

export type SceneShadow = {
  color: SceneColor
  alpha: number
  /** CSS px. */
  blur: number
  offsetX: number
  offsetY: number
}

export type SceneTextRun = {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  color: SceneColor
  alpha: number
  /** Resolved OOXML typeface, already mapped through the font registry. */
  fontFace: string
  /** Points. */
  fontSize: number
  /** Points; 0 when the deck did not set letter-spacing. */
  charSpacing: number
  /** href when the run sits inside a link. */
  link?: string
  /** CSS `font-weight`, kept so the export lint can report a collapse to bold. */
  sourceWeight: number
}

export type SceneParagraphAlign = 'left' | 'center' | 'right' | 'justify'

export type SceneBullet = {
  type: 'bullet' | 'number'
  /** 0-based nesting depth. */
  level: number
}

export type SceneParagraph = {
  runs: SceneTextRun[]
  align: SceneParagraphAlign
  /** Points; absent when the deck left line-height at `normal`. */
  lineSpacing?: number
  bullet?: SceneBullet
}

/** CSS px insets, mapped to a PowerPoint text-box margin on export. */
export type SceneInset = { top: number; right: number; bottom: number; left: number }

export type SceneTextNode = {
  kind: 'text'
  rect: SceneRect
  paragraphs: SceneParagraph[]
  inset: SceneInset
  /**
   * Line boxes the browser actually produced. Text that fitted on one line must
   * not be allowed to wrap in PowerPoint, whose glyph advances differ just
   * enough to break a tightly-measured label onto a second row.
   */
  lineCount: number
  /** Present when the same element also paints a box behind its text. */
  fill?: SceneFill
  line?: SceneLine
  shadow?: SceneShadow
}

export type SceneImageSizing = 'contain' | 'cover' | 'fill'

export type SceneImageNode = {
  kind: 'image'
  rect: SceneRect
  /** A `data:` URI. Images are inlined so the emitter needs no network. */
  data: string
  sizing: SceneImageSizing
  alt: string
}

export type SceneShapeKind = 'rect' | 'roundRect' | 'ellipse'

export type SceneShapeNode = {
  kind: 'shape'
  rect: SceneRect
  shape: SceneShapeKind
  /** CSS px corner radius; only meaningful for `roundRect`. */
  radius: number
  fill: SceneFill
  line?: SceneLine
  shadow?: SceneShadow
}

export type SceneTableCell = {
  paragraphs: SceneParagraph[]
  colSpan: number
  rowSpan: number
  fill?: SceneFill
  header: boolean
}

export type SceneTableNode = {
  kind: 'table'
  rect: SceneRect
  rows: SceneTableCell[][]
  /** CSS px, one per column. */
  columnWidths: number[]
  /** CSS px, one per row. */
  rowHeights: number[]
}

/**
 * A region to flatten to a picture, cropped from the slide capture on export.
 * `reason` is the CSS feature that forced it, and surfaces in the export lint.
 */
export type SceneRasterNode = {
  kind: 'raster'
  rect: SceneRect
  reason: string
  /** A `data:` URI cropped from the slide capture; absent if capture failed. */
  data?: string
}

export type SceneNode =
  SceneTextNode | SceneImageNode | SceneShapeNode | SceneTableNode | SceneRasterNode

export type SceneWarning = {
  code: string
  message: string
  count: number
}

export type SceneSlide = {
  index: number
  background: SceneFill
  /** Paint order: earlier nodes sit behind later ones. */
  nodes: SceneNode[]
  notes: string | null
  warnings: SceneWarning[]
}

export type DeckScene = {
  width: typeof SCENE_FRAME_WIDTH
  height: typeof SCENE_FRAME_HEIGHT
  slides: SceneSlide[]
}

export function isSceneNodeKind<K extends SceneNode['kind']>(
  node: SceneNode,
  kind: K,
): node is Extract<SceneNode, { kind: K }> {
  return node.kind === kind
}

/** Flatten per-slide warnings into one deck-level tally for the export lint. */
export function summarizeSceneWarnings(slides: SceneSlide[]): SceneWarning[] {
  const totals = new Map<string, SceneWarning>()

  for (const slide of slides) {
    for (const warning of slide.warnings) {
      const existing = totals.get(warning.code)
      if (existing) {
        existing.count += warning.count
        continue
      }
      totals.set(warning.code, { ...warning })
    }
  }

  return [...totals.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}
