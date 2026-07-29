import { BoxSelectIcon, PresentationIcon, XIcon } from 'lucide-react'

import type { EditorSelectionInfo } from '@ark/deck-core/deck-editor-bridge.ts'
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
}

function formatElementChipLabel(element: ContextChipElement): string {
  const kind = element.kind || 'element'
  const preview = element.textPreview?.trim()
  const previewNote = preview
    ? ` · “${preview.length > 40 ? `${preview.slice(0, 40)}…` : preview}”`
    : ''
  return `Slide ${element.slideIndex + 1} · ${kind}${previewNote}`
}

export function ContextChipList({
  element = null,
  slides = [],
  onClearElement,
  onRemoveSlide,
  className,
  label = 'Chat context',
}: ContextChipListProps) {
  if (!element && slides.length === 0) {
    return null
  }

  const dismissible = Boolean(onClearElement || onRemoveSlide)

  return (
    <section aria-label={label} className={cn(className)}>
      <ul className="flex flex-wrap gap-1.5">
        {element ? (
          <li
            className={cn(
              'flex max-w-full items-center gap-1.5 rounded-md border border-[var(--ark-accent)]/40',
              'bg-[var(--ark-accent)]/10 px-2 py-1 text-xs text-foreground',
            )}
          >
            <BoxSelectIcon aria-hidden className="size-3.5 shrink-0 text-[var(--ark-accent)]" />
            <span className="min-w-0 truncate font-medium">{formatElementChipLabel(element)}</span>
            {onClearElement ? (
              <button
                aria-label="Remove selected element from chat context"
                className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                onClick={onClearElement}
                type="button"
              >
                <XIcon className="size-3.5" />
              </button>
            ) : null}
          </li>
        ) : null}

        {slides.map((slide) => (
          <li
            className={cn(
              'flex max-w-full items-center gap-1.5 rounded-md border border-border/60',
              'bg-background px-2 py-1 text-xs text-foreground',
            )}
            key={slide.slideIndex}
          >
            <PresentationIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-medium">
              Slide {slide.slideIndex + 1}
              {slide.title ? ` — ${slide.title}` : ''}
            </span>
            {onRemoveSlide ? (
              <button
                aria-label={`Remove slide ${slide.slideIndex + 1} from chat context`}
                className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                onClick={() => onRemoveSlide(slide.slideIndex)}
                type="button"
              >
                <XIcon className="size-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {!dismissible ? <span className="sr-only">Read-only chat context</span> : null}
    </section>
  )
}

export type ChatContextChipsProps = {
  editorSelection: EditorSelectionInfo | null
  slides: ContextChipSlide[]
  onClearEditorSelection: () => void
  onRemoveSlide: (slideIndex: number) => void
}

export function ChatContextChips({
  editorSelection,
  slides,
  onClearEditorSelection,
  onRemoveSlide,
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
      className="mb-3"
      element={element}
      onClearElement={onClearEditorSelection}
      onRemoveSlide={onRemoveSlide}
      slides={slides}
    />
  )
}
