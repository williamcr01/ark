import { useState } from 'react'
import { CheckIcon, PaletteIcon } from 'lucide-react'

import type { ThemeProposalRequest } from '@ark/deck-core/agent-themes.ts'
import { MiniHtmlPreview } from '@/components/MiniHtmlPreview'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type ThemePickerProps = {
  request: ThemeProposalRequest
  disabled?: boolean
  onSubmit: (themeId: string) => void
  submitLabel?: string
}

export function ThemePicker({
  request,
  disabled = false,
  onSubmit,
  submitLabel = 'Use this theme',
}: ThemePickerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)

  const selected = request.themes.find((theme) => theme.id === selectedId) ?? null
  const enlarged = request.themes.find((theme) => theme.id === previewId) ?? null

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-background/60 p-3">
      <div className="flex items-start gap-2">
        <PaletteIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{request.title}</p>
          <p className="text-muted-foreground text-xs">
            Pick the visual direction for the first draft.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {request.themes.map((theme) => {
          const isSelected = theme.id === selectedId
          return (
            <div
              className={cn(
                'relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors',
                isSelected
                  ? 'border-foreground/30 bg-muted/70 ring-1 ring-foreground/15'
                  : 'border-border/80 bg-background/40',
                disabled ? 'opacity-50' : 'hover:border-foreground/20',
              )}
              key={theme.id}
            >
              <button
                aria-label={`Select ${theme.name}`}
                aria-pressed={isSelected}
                className="group flex w-full flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={disabled}
                onClick={() => setSelectedId(theme.id)}
                onDoubleClick={() => setPreviewId(theme.id)}
                type="button"
              >
                <span className="relative block w-full">
                  <MiniHtmlPreview html={theme.sampleHtml} title={`${theme.name} preview`} />
                  {isSelected ? (
                    <span className="absolute right-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                      <CheckIcon aria-hidden className="size-3" />
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-col gap-1 p-2 pb-7">
                  <span className="text-sm font-medium text-foreground">{theme.name}</span>
                  <span className="text-muted-foreground line-clamp-2 text-[11px] leading-snug">
                    {theme.description}
                  </span>
                </span>
              </button>
              <button
                className="text-muted-foreground absolute bottom-2 left-2 z-10 w-fit text-[11px] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={disabled}
                onClick={() => setPreviewId(theme.id)}
                type="button"
              >
                Enlarge
              </button>
            </div>
          )
        })}
      </div>

      <Button
        disabled={disabled || !selected}
        onClick={() => {
          if (selected) onSubmit(selected.id)
        }}
        size="sm"
        type="button"
      >
        {selected ? `${submitLabel}: ${selected.name}` : 'Select a theme'}
      </Button>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setPreviewId(null)
        }}
        open={Boolean(enlarged)}
      >
        <DialogContent className="max-w-3xl">
          {enlarged ? (
            <>
              <DialogHeader>
                <DialogTitle>{enlarged.name}</DialogTitle>
                <DialogDescription>{enlarged.description}</DialogDescription>
              </DialogHeader>
              <MiniHtmlPreview
                className="rounded-md border"
                html={enlarged.sampleHtml}
                title={`${enlarged.name} enlarged preview`}
              />
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => {
                    setSelectedId(enlarged.id)
                    setPreviewId(null)
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Select
                </Button>
                <Button
                  onClick={() => {
                    setSelectedId(enlarged.id)
                    setPreviewId(null)
                    onSubmit(enlarged.id)
                  }}
                  size="sm"
                  type="button"
                >
                  {submitLabel}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
