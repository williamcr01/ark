import { CheckIcon } from 'lucide-react'

import type { StoredThemeProposalRequest, ThemeFontPairing } from '@ark/chat/agent-themes.ts'
import type { DeckThemeSpecV1 } from '@ark/deck/document/theme.ts'
import { MiniHtmlPreview } from '@/components/MiniHtmlPreview'
import {
  applyDeckThemeToSampleHtml,
  applyThemeFontPairingToSampleHtml,
  formatThemeFontPairingLabel,
} from '@/lib/chat/theme-fonts'
import { cn } from '@/lib/ui/utils'

import { PaletteStrip } from './ThemePickerShared.tsx'
import { sampleSlides } from './theme-picker-model.ts'

export function ThemePickerCard({
  disabled,
  fontOverride,
  fonts,
  isSelected,
  onSelect,
  spec,
  specOverride,
  theme,
}: {
  disabled?: boolean
  fontOverride?: ThemeFontPairing
  fonts: ThemeFontPairing
  isSelected: boolean
  onSelect: () => void
  spec: DeckThemeSpecV1 | null
  specOverride?: DeckThemeSpecV1
  theme: StoredThemeProposalRequest['themes'][number]
}) {
  const coverIndex =
    sampleSlides(theme.sampleHtml).find((slide) => slide.kind === 'cover')?.index ?? 0
  const preview = specOverride
    ? applyDeckThemeToSampleHtml(theme.sampleHtml, specOverride)
    : fontOverride
      ? applyThemeFontPairingToSampleHtml(theme.sampleHtml, fontOverride)
      : theme.sampleHtml

  return (
    <button
      aria-label={`Select ${theme.name}`}
      aria-pressed={isSelected}
      className={cn(
        'relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isSelected
          ? 'border-foreground/30 bg-muted/70 ring-1 ring-foreground/15'
          : 'border-border/80 bg-background/40',
        disabled ? 'opacity-50' : 'hover:border-foreground/20',
      )}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span className="relative block w-full">
        <MiniHtmlPreview html={preview} slideIndex={coverIndex} title={`${theme.name} preview`} />
        {isSelected ? (
          <span className="absolute right-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-foreground text-background">
            <CheckIcon aria-hidden className="size-3" />
          </span>
        ) : null}
      </span>
      <span className="flex flex-col gap-1 p-2">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">{theme.name}</span>
          {spec ? <PaletteStrip colors={spec.colors} label={theme.name} /> : null}
        </span>
        <span className="text-muted-foreground line-clamp-2 text-[11px] leading-snug">
          {theme.rationale ?? theme.description}
        </span>
        <span className="text-muted-foreground line-clamp-1 text-[11px] leading-snug">
          {formatThemeFontPairingLabel(fonts)}
        </span>
        {spec ? (
          <span className="text-muted-foreground line-clamp-1 text-[10px] leading-snug">
            Cover {spec.slideRecipes.cover.layout} · Content {spec.slideRecipes.content.layout}
          </span>
        ) : null}
      </span>
    </button>
  )
}
