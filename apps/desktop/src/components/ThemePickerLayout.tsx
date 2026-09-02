import { PaletteIcon } from 'lucide-react'

import type { StoredThemeProposalRequest, ThemeFontPairing } from '@ark/chat/agent-themes.ts'
import type { DeckThemeSpecV1 } from '@ark/deck/document/theme.ts'
import { Button } from '@/components/ui/button'

export type ThemePickerResult =
  | {
      action: 'select'
      themeId: string
      name: string
      fonts: ThemeFontPairing
      theme: DeckThemeSpecV1 | null
    }
  | { action: 'refresh' }

export function ThemePickerHeader({ title }: { title: string }) {
  return (
    <div className="flex items-start gap-2">
      <PaletteIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-muted-foreground text-xs">
          Compare directions, then customize the one you want.
        </p>
      </div>
    </div>
  )
}

export function ThemePickerActions({
  contrastIssueCount,
  disabled,
  onSubmit,
  selected,
  selectedFonts,
  selectedSpec,
  submitLabel,
}: {
  contrastIssueCount: number
  disabled?: boolean
  onSubmit: (result: ThemePickerResult) => void
  selected: StoredThemeProposalRequest['themes'][number] | null
  selectedFonts: ThemeFontPairing | null
  selectedSpec: DeckThemeSpecV1 | null
  submitLabel: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={disabled}
        onClick={() => onSubmit({ action: 'refresh' })}
        size="sm"
        type="button"
        variant="ghost"
      >
        Suggest different options
      </Button>
      <Button
        disabled={disabled || !selected || !selectedFonts || contrastIssueCount > 0}
        onClick={() => {
          if (!selected || !selectedFonts) return
          onSubmit({
            action: 'select',
            themeId: selected.id,
            name: selected.name,
            fonts: selectedFonts,
            theme: selectedSpec,
          })
        }}
        size="sm"
        type="button"
      >
        {selected ? `${submitLabel}: ${selected.name}` : 'Select a theme'}
      </Button>
    </div>
  )
}
