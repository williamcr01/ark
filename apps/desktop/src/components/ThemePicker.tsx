import { useState } from 'react'
import { CheckIcon, PaletteIcon } from 'lucide-react'

import type {
  ThemeCandidate,
  ThemeFontPairing,
  ThemeProposalRequest,
} from '@ark/chat/agent-themes.ts'
import { DECK_FONT_ROLES, type DeckFontRole } from '@ark/runtime-registry/deck-font-registry.ts'
import { MiniHtmlPreview } from '@/components/MiniHtmlPreview'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  applyThemeFontPairingToSampleHtml,
  formatThemeFontPairingLabel,
  resolveThemeFontPairing,
  THEME_FONT_ROLE_LABELS,
  themeFontRoleOptions,
} from '@/lib/chat/theme-fonts'
import { cn } from '@/lib/ui/utils'

type ThemePickerProps = {
  request: ThemeProposalRequest
  disabled?: boolean
  onSubmit: (themeId: string, fonts: ThemeFontPairing) => void
  submitLabel?: string
}

const FONT_OPTIONS = themeFontRoleOptions()

function ThemeFontRoleSelects({
  disabled,
  fonts,
  themeName,
  onChange,
}: {
  disabled?: boolean
  fonts: ThemeFontPairing
  themeName: string
  onChange: (role: DeckFontRole, id: string) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {DECK_FONT_ROLES.map((role) => {
        const label = THEME_FONT_ROLE_LABELS[role]
        return (
          <label className="flex min-w-0 flex-col gap-0.5" key={role}>
            <span className="text-muted-foreground text-[10px] leading-none">{label}</span>
            <select
              aria-label={`${label} font for ${themeName}`}
              className="h-6 w-full min-w-0 rounded-sm border border-border/80 bg-background px-1 text-[11px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              disabled={disabled}
              onChange={(event) => onChange(role, event.target.value)}
              value={fonts[role]}
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
        )
      })}
    </div>
  )
}

export function ThemePicker({
  request,
  disabled = false,
  onSubmit,
  submitLabel = 'Use this theme',
}: ThemePickerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [fontOverrides, setFontOverrides] = useState<Record<string, ThemeFontPairing>>({})

  const fontsFor = (theme: ThemeCandidate) => fontOverrides[theme.id] ?? theme.fonts

  const updateFonts = (theme: ThemeCandidate, role: DeckFontRole, id: string) => {
    setSelectedId(theme.id)
    setFontOverrides((current) => ({
      ...current,
      [theme.id]: resolveThemeFontPairing(fontsFor(theme), role, id),
    }))
  }

  const selected = request.themes.find((theme) => theme.id === selectedId) ?? null
  const enlarged = request.themes.find((theme) => theme.id === previewId) ?? null
  const selectedFonts = selected ? fontsFor(selected) : null
  const enlargedFonts = enlarged ? fontsFor(enlarged) : null

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
          const fonts = fontsFor(theme)
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
                  <MiniHtmlPreview
                    html={applyThemeFontPairingToSampleHtml(theme.sampleHtml, fonts)}
                    title={`${theme.name} preview`}
                  />
                  {isSelected ? (
                    <span className="absolute right-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                      <CheckIcon aria-hidden className="size-3" />
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-col gap-1 p-2 pb-1">
                  <span className="text-sm font-medium text-foreground">{theme.name}</span>
                  <span className="text-muted-foreground line-clamp-2 text-[11px] leading-snug">
                    {theme.description}
                  </span>
                  <span className="text-muted-foreground line-clamp-1 text-[11px] leading-snug">
                    {formatThemeFontPairingLabel(fonts)}
                  </span>
                </span>
              </button>
              <div className="flex flex-col gap-1.5 px-2 pb-2">
                <ThemeFontRoleSelects
                  disabled={disabled}
                  fonts={fonts}
                  onChange={(role, id) => updateFonts(theme, role, id)}
                  themeName={theme.name}
                />
                <button
                  className="text-muted-foreground w-fit text-[11px] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={disabled}
                  onClick={() => setPreviewId(theme.id)}
                  type="button"
                >
                  Enlarge
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <Button
        disabled={disabled || !selected || !selectedFonts}
        onClick={() => {
          if (selected && selectedFonts) onSubmit(selected.id, selectedFonts)
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
          {enlarged && enlargedFonts ? (
            <>
              <DialogHeader>
                <DialogTitle>{enlarged.name}</DialogTitle>
                <DialogDescription>{enlarged.description}</DialogDescription>
              </DialogHeader>
              <MiniHtmlPreview
                className="rounded-md border"
                html={applyThemeFontPairingToSampleHtml(enlarged.sampleHtml, enlargedFonts)}
                title={`${enlarged.name} enlarged preview`}
              />
              <ThemeFontRoleSelects
                disabled={disabled}
                fonts={enlargedFonts}
                onChange={(role, id) => updateFonts(enlarged, role, id)}
                themeName={enlarged.name}
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
                    onSubmit(enlarged.id, enlargedFonts)
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
