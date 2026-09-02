import { useMemo, useState } from 'react'
import { CheckIcon, PaletteIcon } from 'lucide-react'

import type { StoredThemeProposalRequest, ThemeFontPairing } from '@ark/chat/agent-themes.ts'
import {
  deckThemeContrastIssues,
  patchDeckTheme,
  DECK_THEME_COLOR_ROLES,
  hexColorSchema,
  type DeckThemeColorRole,
  type DeckThemeSpecV1,
} from '@ark/deck/document/theme.ts'
import { DECK_FONT_ROLES, type DeckFontRole } from '@ark/runtime-registry/deck-font-registry.ts'
import { MiniHtmlPreview } from '@/components/MiniHtmlPreview'
import { Button } from '@/components/ui/button'
import {
  applyDeckThemeToSampleHtml,
  applyThemeFontPairingToSampleHtml,
  formatThemeFontPairingLabel,
  resolveThemeFontPairing,
  THEME_FONT_ROLE_LABELS,
  themeFontRoleOptions,
} from '@/lib/chat/theme-fonts'
import { cn } from '@/lib/ui/utils'

export type ThemePickerResult =
  | {
      action: 'select'
      themeId: string
      name: string
      fonts: ThemeFontPairing
      theme: DeckThemeSpecV1 | null
    }
  | { action: 'refresh' }

type ThemePickerProps = {
  request: StoredThemeProposalRequest
  disabled?: boolean
  onSubmit: (result: ThemePickerResult) => void
  size?: 'sm' | 'lg'
  submitLabel?: string
}

const FONT_OPTIONS = themeFontRoleOptions()

const COLOR_LABELS: Record<DeckThemeColorRole, string> = {
  canvas: 'Canvas',
  surface: 'Surface',
  foreground: 'Text',
  muted: 'Muted',
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent',
}

function sampleSlides(html: string) {
  const marked = [...html.matchAll(/data-ark-slide-kind="([^"]+)"/g)].map((match, index) => ({
    index,
    kind: match[1]!,
    label: `${match[1]!.slice(0, 1).toUpperCase()}${match[1]!.slice(1)}`,
  }))
  if (marked.length > 0) return marked
  const count = Math.max(1, (html.match(/<section\b/gi) ?? []).length)
  return Array.from({ length: count }, (_, index) => ({
    index,
    kind: `slide-${index}`,
    label: count === 1 ? 'Preview' : `Slide ${index + 1}`,
  }))
}

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

function PaletteStrip({ colors, label }: { colors: DeckThemeSpecV1['colors']; label: string }) {
  return (
    <div aria-label={`${label} palette`} className="flex gap-0.5">
      {DECK_THEME_COLOR_ROLES.map((role) => (
        <span
          className="size-2.5 rounded-full border border-black/15"
          key={role}
          style={{ background: colors[role] }}
          title={`${COLOR_LABELS[role]} ${colors[role]}`}
        />
      ))}
    </div>
  )
}

export function ThemePicker({
  request,
  disabled = false,
  onSubmit,
  size = 'sm',
  submitLabel = 'Use this theme',
}: ThemePickerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fontOverrides, setFontOverrides] = useState<Record<string, ThemeFontPairing>>({})
  const [themeOverrides, setThemeOverrides] = useState<Record<string, DeckThemeSpecV1>>({})
  const [previewKind, setPreviewKind] = useState<string | null>(null)

  const fontsFor = (theme: StoredThemeProposalRequest['themes'][number]) =>
    fontOverrides[theme.id] ?? theme.theme?.fonts ?? theme.fonts

  const specFor = (theme: StoredThemeProposalRequest['themes'][number]) =>
    themeOverrides[theme.id] ?? theme.theme ?? null

  const updateFonts = (
    theme: StoredThemeProposalRequest['themes'][number],
    role: DeckFontRole,
    id: string,
  ) => {
    setSelectedId(theme.id)
    const fonts = resolveThemeFontPairing(fontsFor(theme), role, id)
    setFontOverrides((current) => ({ ...current, [theme.id]: fonts }))
    const spec = specFor(theme)
    if (!spec) return
    setThemeOverrides((current) => ({
      ...current,
      [theme.id]: patchDeckTheme(spec, { fonts }),
    }))
  }

  const updateColor = (
    theme: StoredThemeProposalRequest['themes'][number],
    role: DeckThemeColorRole,
    value: string,
  ) => {
    const spec = specFor(theme)
    if (!spec) return
    const parsed = hexColorSchema.safeParse(value)
    if (!parsed.success) return
    setSelectedId(theme.id)
    setThemeOverrides((current) => ({
      ...current,
      [theme.id]: patchDeckTheme(spec, {
        colors: { ...spec.colors, [role]: parsed.data },
      }),
    }))
  }

  const selected = request.themes.find((theme) => theme.id === selectedId) ?? null
  const selectedFonts = selected ? fontsFor(selected) : null
  const selectedSpec = selected ? specFor(selected) : null
  const contrastIssues = selectedSpec ? deckThemeContrastIssues(selectedSpec.colors) : []
  const slides = selected ? sampleSlides(selected.sampleHtml) : []
  const activeSlide = slides.find((slide) => slide.kind === previewKind) ??
    slides[0] ?? { index: 0, kind: 'cover', label: 'Cover' }

  const previewHtml = useMemo(() => {
    if (!selected || !selectedFonts) return ''
    if (themeOverrides[selected.id] && selectedSpec) {
      return applyDeckThemeToSampleHtml(selected.sampleHtml, selectedSpec)
    }
    if (fontOverrides[selected.id]) {
      return applyThemeFontPairingToSampleHtml(selected.sampleHtml, selectedFonts)
    }
    return selected.sampleHtml
  }, [fontOverrides, selected, selectedFonts, selectedSpec, themeOverrides])

  const isLarge = size === 'lg'

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-border/80 bg-background/60',
        isLarge ? 'gap-4 p-4' : 'gap-3 p-3',
      )}
    >
      <div className="flex items-start gap-2">
        <PaletteIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{request.title}</p>
          <p className="text-muted-foreground text-xs">
            Compare directions, then customize the one you want.
          </p>
        </div>
      </div>

      <div className={cn('grid grid-cols-2', isLarge ? 'gap-3' : 'gap-2')}>
        {request.themes.map((theme) => {
          const isSelected = theme.id === selectedId
          const fonts = fontsFor(theme)
          const spec = specFor(theme)
          const specOverride = themeOverrides[theme.id]
          const fontOverride = fontOverrides[theme.id]
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
              key={theme.id}
              onClick={() => {
                setSelectedId(theme.id)
                setPreviewKind('cover')
              }}
              type="button"
            >
              <span className="relative block w-full">
                <MiniHtmlPreview
                  html={preview}
                  slideIndex={coverIndex}
                  title={`${theme.name} preview`}
                />
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
                    Cover {spec.slideRecipes.cover.layout} · Content{' '}
                    {spec.slideRecipes.content.layout}
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>

      {selected && selectedFonts ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-background/80 p-2">
          {slides.length > 1 ? (
            <div className="flex flex-wrap gap-1" role="tablist">
              {slides.map((slide) => (
                <button
                  aria-selected={activeSlide.kind === slide.kind}
                  className={cn(
                    'rounded-md px-2 py-1 text-[11px] font-medium',
                    activeSlide.kind === slide.kind
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                  disabled={disabled}
                  key={slide.kind}
                  onClick={() => setPreviewKind(slide.kind)}
                  role="tab"
                  type="button"
                >
                  {slide.label}
                </button>
              ))}
            </div>
          ) : null}

          <MiniHtmlPreview
            html={previewHtml}
            slideIndex={activeSlide.index}
            title={`${selected.name} ${activeSlide.label}`}
          />

          <ThemeFontRoleSelects
            disabled={disabled}
            fonts={selectedFonts}
            onChange={(role, id) => updateFonts(selected, role, id)}
            themeName={selected.name}
          />

          {selectedSpec ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DECK_THEME_COLOR_ROLES.map((role) => (
                <label className="flex min-w-0 flex-col gap-0.5" key={role}>
                  <span className="text-muted-foreground text-[10px] leading-none">
                    {COLOR_LABELS[role]}
                  </span>
                  <span className="flex items-center gap-1">
                    <input
                      aria-label={`${COLOR_LABELS[role]} color for ${selected.name}`}
                      className="size-6 cursor-pointer rounded-sm border border-border bg-background p-0"
                      disabled={disabled}
                      onChange={(event) => updateColor(selected, role, event.target.value)}
                      type="color"
                      value={selectedSpec.colors[role]}
                    />
                    <input
                      aria-label={`${COLOR_LABELS[role]} hex for ${selected.name}`}
                      className="h-6 min-w-0 flex-1 rounded-sm border border-border/80 bg-background px-1 font-mono text-[10px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      disabled={disabled}
                      onChange={(event) => updateColor(selected, role, event.target.value)}
                      value={selectedSpec.colors[role]}
                    />
                  </span>
                </label>
              ))}
            </div>
          ) : null}

          {contrastIssues.length > 0 ? (
            <ul className="text-destructive text-[11px] leading-snug">
              {contrastIssues.map((issue) => (
                <li key={issue.path}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

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
          disabled={disabled || !selected || !selectedFonts || contrastIssues.length > 0}
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
    </div>
  )
}
