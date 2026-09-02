import { useMemo, useState } from 'react'

import type { StoredThemeProposalRequest, ThemeFontPairing } from '@ark/chat/agent-themes.ts'
import {
  deckThemeContrastIssues,
  patchDeckTheme,
  hexColorSchema,
  type DeckThemeColorRole,
  type DeckThemeSpecV1,
} from '@ark/deck/document/theme.ts'
import type { DeckFontRole } from '@ark/runtime-registry/deck-font-registry.ts'
import {
  applyDeckThemeToSampleHtml,
  applyThemeFontPairingToSampleHtml,
  resolveThemeFontPairing,
} from '@/lib/chat/theme-fonts'
import { cn } from '@/lib/ui/utils'

import { ThemePickerCard } from './ThemePickerCard.tsx'
import {
  ThemePickerActions,
  ThemePickerHeader,
  type ThemePickerResult,
} from './ThemePickerLayout.tsx'
import { ThemePickerCustomize } from './ThemePickerShared.tsx'
import { sampleSlides } from './theme-picker-model.ts'

export type { ThemePickerResult }

type ThemePickerProps = {
  request: StoredThemeProposalRequest
  disabled?: boolean
  onSubmit: (result: ThemePickerResult) => void
  size?: 'sm' | 'lg'
  submitLabel?: string
}

type ThemeOption = StoredThemeProposalRequest['themes'][number]

function fontsForTheme(theme: ThemeOption, fontOverrides: Record<string, ThemeFontPairing>) {
  return fontOverrides[theme.id] ?? theme.theme?.fonts ?? theme.fonts
}

function specForTheme(theme: ThemeOption, themeOverrides: Record<string, DeckThemeSpecV1>) {
  return themeOverrides[theme.id] ?? theme.theme ?? null
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

  const updateFonts = (theme: ThemeOption, role: DeckFontRole, id: string) => {
    setSelectedId(theme.id)
    const fonts = resolveThemeFontPairing(fontsForTheme(theme, fontOverrides), role, id)
    setFontOverrides((current) => ({ ...current, [theme.id]: fonts }))
    const spec = specForTheme(theme, themeOverrides)
    if (!spec) return
    setThemeOverrides((current) => ({
      ...current,
      [theme.id]: patchDeckTheme(spec, { fonts }),
    }))
  }

  const updateColor = (theme: ThemeOption, role: DeckThemeColorRole, value: string) => {
    const spec = specForTheme(theme, themeOverrides)
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
  const selectedFonts = selected ? fontsForTheme(selected, fontOverrides) : null
  const selectedSpec = selected ? specForTheme(selected, themeOverrides) : null
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
      <ThemePickerHeader title={request.title} />

      <div className={cn('grid grid-cols-2', isLarge ? 'gap-3' : 'gap-2')}>
        {request.themes.map((theme) => (
          <ThemePickerCard
            disabled={disabled}
            fontOverride={fontOverrides[theme.id]}
            fonts={fontsForTheme(theme, fontOverrides)}
            isSelected={theme.id === selectedId}
            key={theme.id}
            onSelect={() => {
              setSelectedId(theme.id)
              setPreviewKind('cover')
            }}
            spec={specForTheme(theme, themeOverrides)}
            specOverride={themeOverrides[theme.id]}
            theme={theme}
          />
        ))}
      </div>

      {selected && selectedFonts ? (
        <ThemePickerCustomize
          activeSlide={activeSlide}
          contrastIssues={contrastIssues}
          disabled={disabled}
          onPreviewKind={setPreviewKind}
          onUpdateColor={updateColor}
          onUpdateFonts={updateFonts}
          previewHtml={previewHtml}
          selected={selected}
          selectedFonts={selectedFonts}
          selectedSpec={selectedSpec}
          slides={slides}
        />
      ) : null}

      <ThemePickerActions
        contrastIssueCount={contrastIssues.length}
        disabled={disabled}
        onSubmit={onSubmit}
        selected={selected}
        selectedFonts={selectedFonts}
        selectedSpec={selectedSpec}
        submitLabel={submitLabel}
      />
    </div>
  )
}
