import type { EditorNormalizedRect } from './deck-editor-bridge.ts'
import {
  ARK_EDITABLE_ATTR,
  ARK_MANAGED_ATTR,
  ARK_ROLE_ATTR,
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from './deck-metadata.ts'

export const ARK_TEXT_BOX_CLASS = 'ark-text-box' as const
export const ARK_TEXT_BOX_EDITABLE_VALUE = 'text-box' as const
export const DEFAULT_TEXT_BOX_TEXT = 'New text' as const

/** Minimum normalized width/height when drawing or clicking to insert a text box. */
export const MIN_TEXT_BOX_NORMALIZED_SIZE = 0.04 as const

/** Default normalized size for a click-inserted text box (no drag). */
export const DEFAULT_TEXT_BOX_NORMALIZED_SIZE = {
  width: 0.3,
  height: 0.08,
} as const

export function isTextBoxEditableValue(value: string | null | undefined) {
  return value === ARK_TEXT_BOX_EDITABLE_VALUE
}

export function formatNormalizedToPixels(normalized: number, reference: number) {
  return `${Math.round(normalized * reference)}px`
}

export function clampNormalizedUnit(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(1, value))
}

export function clampNormalizedRect(rect: EditorNormalizedRect): EditorNormalizedRect {
  const width = Math.max(MIN_TEXT_BOX_NORMALIZED_SIZE, clampNormalizedUnit(rect.width))
  const height = Math.max(MIN_TEXT_BOX_NORMALIZED_SIZE, clampNormalizedUnit(rect.height))
  const x = clampNormalizedUnit(rect.x)
  const y = clampNormalizedUnit(rect.y)

  return {
    x: Math.min(x, Math.max(0, 1 - width)),
    y: Math.min(y, Math.max(0, 1 - height)),
    width,
    height,
  }
}

export function normalizedRectFromPoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): EditorNormalizedRect {
  const x = Math.min(startX, endX)
  const y = Math.min(startY, endY)
  const width = Math.abs(endX - startX)
  const height = Math.abs(endY - startY)

  return clampNormalizedRect({ x, y, width, height })
}

export function normalizedPointFromClient(
  clientX: number,
  clientY: number,
  slideRect: DOMRect,
): { x: number; y: number } {
  if (!slideRect.width || !slideRect.height) {
    return { x: 0, y: 0 }
  }

  return {
    x: clampNormalizedUnit((clientX - slideRect.left) / slideRect.width),
    y: clampNormalizedUnit((clientY - slideRect.top) / slideRect.height),
  }
}

export function normalizedRectToInlineStyle(geometry: EditorNormalizedRect) {
  const rect = clampNormalizedRect(geometry)

  return {
    position: 'absolute',
    left: formatNormalizedToPixels(rect.x, ARK_SLIDE_REFERENCE_WIDTH),
    top: formatNormalizedToPixels(rect.y, ARK_SLIDE_REFERENCE_HEIGHT),
    width: formatNormalizedToPixels(rect.width, ARK_SLIDE_REFERENCE_WIDTH),
    'min-height': formatNormalizedToPixels(rect.height, ARK_SLIDE_REFERENCE_HEIGHT),
    'z-index': '1',
  }
}

export function buildTextBoxHtml(geometry: EditorNormalizedRect, text = DEFAULT_TEXT_BOX_TEXT) {
  const style = normalizedRectToInlineStyle(geometry)
  const styleText = Object.entries(style)
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ')

  return `<div class="${ARK_TEXT_BOX_CLASS}" ${ARK_EDITABLE_ATTR}="${ARK_TEXT_BOX_EDITABLE_VALUE}" ${ARK_MANAGED_ATTR}="true" ${ARK_ROLE_ATTR}="user-inserted" style="${styleText}"><p>${escapeHtmlText(text)}</p></div>`
}

function escapeHtmlText(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
