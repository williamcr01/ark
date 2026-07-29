import { BoxSelectIcon, PresentationIcon, XIcon } from 'lucide-react'

import type { EditorSelectionInfo } from '@ark/deck-core/deck-editor-bridge.ts'
import { cn } from '@/lib/utils'

export type ChatContextSlide = {
  slideIndex: number
  title: string
}

export type ChatContextChipsProps = {
  editorSelection: EditorSelectionInfo | null
  slides: ChatContextSlide[]
  onClearEditorSelection: () => void
  onRemoveSlide: (slideIndex: number) => void
}

function formatElementChipLabel(selection: EditorSelectionInfo): string {
  const kind = selection.editableKind || selection.tagName || 'element'
  const preview = selection.textPreview?.trim()
  const previewNote = preview
    ? ` · “${preview.length > 40 ? `${preview.slice(0, 40)}…` : preview}”`
    : ''
  return `Slide ${selection.slideIndex + 1} · ${kind}${previewNote}`
}

export function ChatContextChips({
  editorSelection,
  slides,
  onClearEditorSelection,
  onRemoveSlide,
}: ChatContextChipsProps) {
  if (!editorSelection && slides.length === 0) {
    return null
  }

  return (
    <section aria-label="Chat context" className="mb-3">
      <ul className="flex flex-wrap gap-1.5">
        {editorSelection ? (
          <li
            className={cn(
              'flex max-w-full items-center gap-1.5 rounded-md border border-[var(--ark-accent)]/40',
              'bg-[var(--ark-accent)]/10 px-2 py-1 text-xs text-foreground',
            )}
          >
            <BoxSelectIcon aria-hidden className="size-3.5 shrink-0 text-[var(--ark-accent)]" />
            <span className="min-w-0 truncate font-medium">
              {formatElementChipLabel(editorSelection)}
            </span>
            <button
              aria-label="Remove selected element from chat context"
              className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
              onClick={onClearEditorSelection}
              type="button"
            >
              <XIcon className="size-3.5" />
            </button>
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
            <button
              aria-label={`Remove slide ${slide.slideIndex + 1} from chat context`}
              className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
              onClick={() => onRemoveSlide(slide.slideIndex)}
              type="button"
            >
              <XIcon className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
