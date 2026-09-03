import {
  DECK_THEME_COLOR_ROLES,
  type DeckThemeColorRole,
  type DeckThemeSpecV1,
} from '@ark/deck/document/theme.ts'
import { DECK_FONT_ROLES, type DeckFontRole } from '@ark/runtime-registry/deck-font-registry.ts'
import type { StoredThemeProposalRequest, ThemeFontPairing } from '@ark/chat/agent-themes.ts'
import { MiniHtmlPreview } from '@/components/MiniHtmlPreview'
import { THEME_FONT_ROLE_LABELS, themeFontRoleOptions } from '@/lib/chat/theme-fonts'
import { cn } from '@/lib/ui/utils'

import { COLOR_LABELS } from './theme-picker-model.ts'

const FONT_OPTIONS = themeFontRoleOptions()

export function ThemeFontRoleSelects({
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

export function PaletteStrip({
  colors,
  label,
}: {
  colors: DeckThemeSpecV1['colors']
  label: string
}) {
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

export function ThemePickerCustomize({
  activeSlide,
  contrastIssues,
  disabled,
  previewHtml,
  selected,
  selectedFonts,
  selectedSpec,
  slides,
  onPreviewKind,
  onUpdateColor,
  onUpdateFonts,
}: {
  activeSlide: { index: number; kind: string; label: string }
  contrastIssues: Array<{ path: string; message: string }>
  disabled?: boolean
  previewHtml: string
  selected: StoredThemeProposalRequest['themes'][number]
  selectedFonts: ThemeFontPairing
  selectedSpec: DeckThemeSpecV1 | null
  slides: Array<{ index: number; kind: string; label: string }>
  onPreviewKind: (kind: string) => void
  onUpdateColor: (
    theme: StoredThemeProposalRequest['themes'][number],
    role: DeckThemeColorRole,
    value: string,
  ) => void
  onUpdateFonts: (
    theme: StoredThemeProposalRequest['themes'][number],
    role: DeckFontRole,
    id: string,
  ) => void
}) {
  return (
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
              onClick={() => onPreviewKind(slide.kind)}
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
        onChange={(role, id) => onUpdateFonts(selected, role, id)}
        themeName={selected.name}
      />

      {selectedSpec ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DECK_THEME_COLOR_ROLES.map((role) => (
            <fieldset className="flex min-w-0 flex-col gap-0.5" key={role}>
              <legend className="text-muted-foreground text-[10px] leading-none">
                {COLOR_LABELS[role]}
              </legend>
              <span className="flex items-center gap-1">
                <input
                  aria-label={`${COLOR_LABELS[role]} color for ${selected.name}`}
                  className="size-6 cursor-pointer rounded-sm border border-border bg-background p-0"
                  disabled={disabled}
                  onChange={(event) => onUpdateColor(selected, role, event.target.value)}
                  type="color"
                  value={selectedSpec.colors[role]}
                />
                <input
                  aria-label={`${COLOR_LABELS[role]} hex for ${selected.name}`}
                  className="h-6 min-w-0 flex-1 rounded-sm border border-border/80 bg-background px-1 font-mono text-[10px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  disabled={disabled}
                  onChange={(event) => onUpdateColor(selected, role, event.target.value)}
                  value={selectedSpec.colors[role]}
                />
              </span>
            </fieldset>
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
  )
}
