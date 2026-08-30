/** Selected element inspector helpers (issue #84). */

import type { EditorNormalizedRect, EditorSelectionInfo } from '@ark/editor-runtime'
import type { DeckElementPatchOperation } from '@ark/deck/patch/patch-request.ts'
import { isInlineTextEditableTag } from '@ark/deck/document/editable.ts'
import { isTextBoxEditableValue } from '@ark/deck/patch/text-box.ts'
import {
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck/document/metadata.ts'

export type InspectorElementKind = 'text-box' | 'image' | 'text' | 'element'

export type InspectorGeometryField = 'x' | 'y' | 'width' | 'height'

export function getInspectorElementKind(selection: EditorSelectionInfo): InspectorElementKind {
  if (selection.editableKind === 'image' || selection.tagName === 'img') {
    return 'image'
  }

  if (isTextBoxEditableValue(selection.editableKind)) {
    return 'text-box'
  }

  if (isInlineTextEditableTag(selection.tagName)) {
    return 'text'
  }

  return 'element'
}

export function getInspectorKindLabel(kind: InspectorElementKind): string {
  switch (kind) {
    case 'text-box':
      return 'Text box'
    case 'image':
      return 'Image'
    case 'text':
      return 'Text'
    default:
      return 'Element'
  }
}

export function showTextSection(selection: EditorSelectionInfo): boolean {
  const kind = getInspectorElementKind(selection)

  return (kind === 'text-box' || kind === 'text') && Boolean(selection.textStyle)
}

export function showImageSection(selection: EditorSelectionInfo): boolean {
  return getInspectorElementKind(selection) === 'image'
}

/**
 * Reason why mutating inspector controls are disabled, or null when the
 * selection is editable. Mirrors the server-side patch rule that locked
 * elements reject mutations.
 */
export function getInspectorDisabledReason(selection: EditorSelectionInfo): string | null {
  if (selection.locked) {
    return 'This element is locked. Unlock it to edit properties.'
  }

  return null
}

/** Builds the shared element target fields for a patch operation. */
export function buildInspectorTarget(selection: EditorSelectionInfo) {
  return {
    elementId: selection.elementId,
    slideIndex: selection.slideIndex,
    ...(selection.slideId ? { slideId: selection.slideId } : {}),
  }
}

export function buildInlineStyleOperation(
  selection: EditorSelectionInfo,
  style: Record<string, string>,
): DeckElementPatchOperation {
  return {
    op: 'set_inline_style',
    ...buildInspectorTarget(selection),
    style,
  }
}

export function buildAttrsOperation(
  selection: EditorSelectionInfo,
  attrs: Record<string, string>,
): DeckElementPatchOperation {
  return {
    op: 'set_attrs',
    ...buildInspectorTarget(selection),
    attrs,
  }
}

const GEOMETRY_EPSILON = 0.0005

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value))
}

/**
 * Builds a move/resize operation for a single geometry field change. `value`
 * is normalized (0–1); the untouched axis keeps the current geometry. Returns
 * null when the change is a no-op.
 */
export function buildGeometryFieldOperation(
  selection: EditorSelectionInfo,
  geometry: EditorNormalizedRect,
  field: InspectorGeometryField,
  value: number,
): DeckElementPatchOperation | null {
  if (!Number.isFinite(value)) {
    return null
  }

  const next = clampUnit(value)

  if (Math.abs(next - geometry[field]) <= GEOMETRY_EPSILON) {
    return null
  }

  if (field === 'x' || field === 'y') {
    return {
      op: 'move_element',
      ...buildInspectorTarget(selection),
      x: field === 'x' ? next : clampUnit(geometry.x),
      y: field === 'y' ? next : clampUnit(geometry.y),
    }
  }

  return {
    op: 'resize_element',
    ...buildInspectorTarget(selection),
    width: field === 'width' ? next : clampUnit(geometry.width),
    height: field === 'height' ? next : clampUnit(geometry.height),
  }
}

/**
 * Resizes an image back to its intrinsic aspect ratio, keeping the current
 * width. Returns null when the aspect ratio is unknown or already matches.
 */
export function buildResetImageAspectOperation(
  selection: EditorSelectionInfo,
  geometry: EditorNormalizedRect,
): DeckElementPatchOperation | null {
  const natural = selection.imageNaturalSize

  if (!natural || natural.width <= 0 || natural.height <= 0) {
    return null
  }

  const aspect = natural.width / natural.height
  const widthPx = geometry.width * ARK_SLIDE_REFERENCE_WIDTH
  let heightPx = widthPx / aspect
  let width = geometry.width

  if (heightPx > ARK_SLIDE_REFERENCE_HEIGHT) {
    heightPx = ARK_SLIDE_REFERENCE_HEIGHT
    width = clampUnit((heightPx * aspect) / ARK_SLIDE_REFERENCE_WIDTH)
  }

  const height = clampUnit(heightPx / ARK_SLIDE_REFERENCE_HEIGHT)

  if (
    Math.abs(height - geometry.height) <= GEOMETRY_EPSILON &&
    Math.abs(width - geometry.width) <= GEOMETRY_EPSILON
  ) {
    return null
  }

  return {
    op: 'resize_element',
    ...buildInspectorTarget(selection),
    width,
    height,
  }
}

/** Formats a normalized unit (0–1) as a percentage string with one decimal. */
export function formatPercentValue(normalized: number): string {
  return (Math.round(normalized * 1000) / 10).toFixed(1)
}

/** Parses a percentage input ("42.5") into a clamped normalized unit, or null. */
export function parsePercentInput(raw: string): number | null {
  const parsed = Number.parseFloat(raw.replace('%', '').trim())

  if (!Number.isFinite(parsed)) {
    return null
  }

  return clampUnit(parsed / 100)
}

export const FONT_WEIGHT_OPTIONS = [
  { value: '400', label: 'Normal' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semibold' },
  { value: '700', label: 'Bold' },
] as const

/** Maps a computed font-weight to the nearest inspector option value. */
export function normalizeFontWeight(computed: string): string {
  const keywordMap: Record<string, string> = { normal: '400', bold: '700' }
  const mapped = keywordMap[computed.trim().toLowerCase()]

  if (mapped) {
    return mapped
  }

  const numeric = Number.parseInt(computed, 10)

  if (!Number.isFinite(numeric)) {
    return '400'
  }

  let nearest: string = FONT_WEIGHT_OPTIONS[0].value
  let smallestDelta = Number.POSITIVE_INFINITY

  for (const option of FONT_WEIGHT_OPTIONS) {
    const delta = Math.abs(Number.parseInt(option.value, 10) - numeric)

    if (delta < smallestDelta) {
      smallestDelta = delta
      nearest = option.value
    }
  }

  return nearest
}

export type InspectorTextAlign = 'left' | 'center' | 'right' | 'justify'

/** Maps a computed text-align keyword to a canonical inspector value. */
export function normalizeTextAlign(computed: string): InspectorTextAlign {
  const value = computed.trim().toLowerCase()

  if (value === 'center' || value === 'right' || value === 'justify') {
    return value
  }

  if (value === 'end') {
    return 'right'
  }

  return 'left'
}

/** Converts a computed CSS color (rgb/rgba or hex) to #rrggbb for color inputs. */
export function cssColorToHex(color: string): string | null {
  const value = color.trim().toLowerCase()

  if (/^#[0-9a-f]{6}$/.test(value)) {
    return value
  }

  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
  }

  const match = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)

  if (!match) {
    return null
  }

  const toHexPart = (part: string) =>
    Math.max(0, Math.min(255, Number.parseInt(part, 10)))
      .toString(16)
      .padStart(2, '0')

  return `#${toHexPart(match[1])}${toHexPart(match[2])}${toHexPart(match[3])}`
}
