import { BoxSelectIcon, PresentationIcon } from 'lucide-react'

import type { EditorSelectionInfo } from '@ark/deck-core/deck-editor-bridge.ts'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPresence,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments'
import { cn } from '@/lib/utils'

export type ContextChipElement = {
  slideIndex: number
  kind?: string
  textPreview?: string | null
}

export type ContextChipSlide = {
  slideIndex: number
  title?: string
}

export type ContextChipListProps = {
  element?: ContextChipElement | null
  slides?: ContextChipSlide[]
  onClearElement?: () => void
  onRemoveSlide?: (slideIndex: number) => void
  className?: string
  /** Accessible name for the chip list container. */
  label?: string
  /**
   * When true, render only attachment items (no wrapping `Attachments`).
   * Use inside an existing inline attachments row (e.g. prompt composer).
   */
  nested?: boolean
}

function formatElementChipLabel(element: ContextChipElement): string {
  const kind = element.kind || 'element'
  const preview = element.textPreview?.trim()
  const previewNote = preview
    ? ` · “${preview.length > 40 ? `${preview.slice(0, 40)}…` : preview}”`
    : ''
  return `Slide ${element.slideIndex + 1} · ${kind}${previewNote}`
}

function formatSlideChipLabel(slide: ContextChipSlide): string {
  return `Slide ${slide.slideIndex + 1}${slide.title ? ` — ${slide.title}` : ''}`
}

export function ContextChipList({
  element = null,
  slides = [],
  onClearElement,
  onRemoveSlide,
  className,
  label = 'Chat context',
  nested = false,
}: ContextChipListProps) {
  if (!element && slides.length === 0) {
    return null
  }

  const dismissible = Boolean(onClearElement || onRemoveSlide)

  const items = (
    <AttachmentPresence>
      {element ? (
        <Attachment
          data={{
            type: 'source-document',
            id: `context-element-${element.slideIndex}`,
            sourceId: `context-element-${element.slideIndex}`,
            title: formatElementChipLabel(element),
            mediaType: 'text/plain',
          }}
          onRemove={onClearElement}
        >
          <AttachmentPreview
            fallbackIcon={<BoxSelectIcon className="size-3 text-muted-foreground" />}
          />
          <AttachmentInfo />
          {onClearElement ? (
            <AttachmentRemove label="Remove selected element from chat context" />
          ) : null}
        </Attachment>
      ) : null}

      {slides.map((slide) => (
        <Attachment
          data={{
            type: 'source-document',
            id: `context-slide-${slide.slideIndex}`,
            sourceId: `context-slide-${slide.slideIndex}`,
            title: formatSlideChipLabel(slide),
            mediaType: 'text/html',
          }}
          key={slide.slideIndex}
          onRemove={onRemoveSlide ? () => onRemoveSlide(slide.slideIndex) : undefined}
        >
          <AttachmentPreview
            fallbackIcon={<PresentationIcon className="size-3 text-muted-foreground" />}
          />
          <AttachmentInfo />
          {onRemoveSlide ? (
            <AttachmentRemove label={`Remove slide ${slide.slideIndex + 1} from chat context`} />
          ) : null}
        </Attachment>
      ))}
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
  slides: ContextChipSlide[]
  onClearEditorSelection: () => void
  onRemoveSlide: (slideIndex: number) => void
  /** Render items into a parent attachments row (composer). */
  nested?: boolean
}

export function ChatContextChips({
  editorSelection,
  slides,
  onClearEditorSelection,
  onRemoveSlide,
  nested = false,
}: ChatContextChipsProps) {
  const element: ContextChipElement | null = editorSelection
    ? {
        slideIndex: editorSelection.slideIndex,
        kind: editorSelection.editableKind || editorSelection.tagName || undefined,
        textPreview: editorSelection.textPreview,
      }
    : null

  return (
    <ContextChipList
      element={element}
      nested={nested}
      onClearElement={onClearEditorSelection}
      onRemoveSlide={onRemoveSlide}
      slides={slides}
    />
  )
}
