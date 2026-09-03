import type { EditorSelectionInfo } from '@ark/editor-runtime'
import { AttachmentPresence, Attachments } from '@/components/ai-elements/attachments'
import { cn } from '@/lib/ui/utils'

import {
  ContextElementChip,
  ContextSlideChips,
  type ContextChipElement,
  type ContextChipSlide,
} from './ChatContextChipItems.tsx'

export type { ContextChipElement, ContextChipSlide }

const EMPTY_CONTEXT_SLIDES: ContextChipSlide[] = []

export type ContextChipListProps = {
  element?: ContextChipElement | null
  /** Render one grouped `N element(s)` chip for the selected elements. */
  elementCount?: number
  slides?: ContextChipSlide[]
  onClearElement?: () => void
  onRemoveSlide?: (slideIndex: number) => void
  onClearSlides?: () => void
  className?: string
  /** Accessible name for the chip list container. */
  label?: string
  /**
   * When true, render only attachment items (no wrapping `Attachments`).
   * Use inside an existing inline attachments row (e.g. prompt composer).
   */
  nested?: boolean
}

export function ContextChipList({
  element = null,
  elementCount,
  slides = EMPTY_CONTEXT_SLIDES,
  onClearElement,
  onRemoveSlide,
  onClearSlides,
  className,
  label = 'Chat context',
  nested = false,
}: ContextChipListProps) {
  const resolvedElementCount = elementCount ?? (element ? 1 : 0)
  if (resolvedElementCount === 0 && slides.length === 0) {
    return null
  }

  const dismissible = Boolean(onClearElement || onRemoveSlide || onClearSlides)
  const items = (
    <AttachmentPresence>
      {resolvedElementCount > 0 ? (
        <ContextElementChip elementCount={resolvedElementCount} onClearElement={onClearElement} />
      ) : null}
      <ContextSlideChips
        onClearSlides={onClearSlides}
        onRemoveSlide={onRemoveSlide}
        slides={slides}
      />
      {!dismissible ? <span className="sr-only">Read-only chat context</span> : null}
    </AttachmentPresence>
  )

  if (nested) {
    return items
  }

  return (
    <Attachments aria-label={label} className={cn(className)} variant="inline">
      {items}
    </Attachments>
  )
}

export type ChatContextChipsProps = {
  editorSelection: EditorSelectionInfo | null
  editorSelections?: EditorSelectionInfo[]
  slides: ContextChipSlide[]
  onClearEditorSelection: () => void
  onRemoveSlide: (slideIndex: number) => void
  onClearSlides?: () => void
  nested?: boolean
}

export function ChatContextChips({
  editorSelection,
  editorSelections,
  slides,
  onClearEditorSelection,
  onRemoveSlide,
  onClearSlides,
  nested = false,
}: ChatContextChipsProps) {
  const selectionSet =
    editorSelections && editorSelections.length > 0
      ? editorSelections
      : editorSelection
        ? [editorSelection]
        : []
  const primary = selectionSet.length === 1 ? selectionSet[0] : editorSelection
  const element: ContextChipElement | null = primary
    ? {
        slideIndex: primary.slideIndex,
        kind: primary.editableKind || primary.tagName || undefined,
        textPreview: primary.textPreview,
      }
    : null

  return (
    <ContextChipList
      element={element}
      elementCount={selectionSet.length}
      nested={nested}
      onClearElement={onClearEditorSelection}
      onClearSlides={onClearSlides}
      onRemoveSlide={onRemoveSlide}
      slides={slides}
    />
  )
}
