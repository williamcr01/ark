/** Editable element metadata model (issue #74). */

export type EditableElementKind =
  'text' | 'image' | 'shape' | 'group' | 'container' | 'runtime-control' | 'unknown'

export type EditableElementRole =
  | 'title'
  | 'subtitle'
  | 'body'
  | 'caption'
  | 'callout'
  | 'chart-label'
  | 'decorative'
  | 'user-inserted'
  | 'unknown'

export type EditableElementLockReason =
  | 'explicit-lock'
  | 'unsafe-tag'
  | 'runtime-control'
  | 'layout-not-managed'
  | 'hidden'
  | 'speaker-notes'
  | 'no-text-content'

export type EditableElementStyle = {
  position?: 'absolute' | 'relative' | 'static' | 'fixed' | 'sticky'
  left?: number
  top?: number
  width?: number
  height?: number
  zIndex?: number
}

export type ParsedEditableElement = {
  id: string
  idTransient: boolean
  slideIndex: number
  slideId: string | null
  kind: EditableElementKind
  role: EditableElementRole
  managed: boolean
  locked: boolean
  lockReason: EditableElementLockReason | null
  textPreview: string | null
  tagName: string
  className: string | null
  attrs: Record<string, string>
  style: EditableElementStyle | null
}

export type SlideEditableElements = {
  slideIndex: number
  slideId: string | null
  slideIdTransient: boolean
  elements: ParsedEditableElement[]
}

/** Tags supported for inline plain-text editing (issue #78). */
export const INLINE_TEXT_EDITABLE_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'blockquote',
  'figcaption',
  'span',
])

export function isInlineTextEditableTag(tagName: string) {
  return INLINE_TEXT_EDITABLE_TAGS.has(tagName.toLowerCase())
}
