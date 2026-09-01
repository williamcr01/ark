import { BoxSelectIcon, PresentationIcon } from 'lucide-react'

import type { EditorSelectionInfo } from '@ark/editor-runtime'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPresence,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments'
import { cn } from '@/lib/ui/utils'

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
  /** When greater than 1, render one grouped `N elements` chip instead of the detailed element chip. */
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
  elementCount,
  slides = [],
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

  const clearAllSlides = () => {
    if (onClearSlides) {
      onClearSlides()
      return
    }

    slides.forEach((slide) => onRemoveSlide?.(slide.slideIndex))
  }

  const dismissible = Boolean(onClearElement || onRemoveSlide || onClearSlides)

  const items = (
    <AttachmentPresence>
      {resolvedElementCount > 1 ? (
        <Attachment
          data={{
            type: 'source-document',
            id: 'context-elements',
            sourceId: 'context-elements',
            title: `${resolvedElementCount} elements`,
            mediaType: 'text/plain',
          }}
          onRemove={onClearElement}
        >
          <AttachmentPreview
            fallbackIcon={<BoxSelectIcon className="size-3 text-muted-foreground" />}
          />
          <AttachmentInfo />
          {onClearElement ? (
            <AttachmentRemove label="Remove selected elements from chat context" />
          ) : null}
        </Attachment>
      ) : element ? (
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

      {slides.length > 1 ? (
        <Attachment
          data={{
            type: 'source-document',
            id: 'context-slides',
            sourceId: 'context-slides',
            title: `${slides.length} slides`,
            mediaType: 'text/html',
          }}
          onRemove={onRemoveSlide || onClearSlides ? clearAllSlides : undefined}
        >
          <AttachmentPreview
            fallbackIcon={<PresentationIcon className="size-3 text-muted-foreground" />}
          />
          <AttachmentInfo />
          {onRemoveSlide || onClearSlides ? (
            <AttachmentRemove label="Remove attached slides from chat context" />
          ) : null}
        </Attachment>
      ) : (
        slides.map((slide) => (
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
        ))
      )}
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
  /** Render items into a parent attachments row (composer). */
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
