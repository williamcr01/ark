import { describe, expect, it } from 'vitest'

import { APPROVED_DECK_FONT_IDS } from '@ark/runtime-registry/deck-font-registry.ts'
import { exampleDeckThemes } from '@ark/deck/document/theme.ts'

import {
  DEFAULT_THEME_FONT_PAIRING,
  deckFontIdSchema,
  exampleThemeProposal,
  formatThemeChoice,
  isThemeRefreshContent,
  parseStoredThemeProposalRequest,
  parseThemeChoiceFonts,
  parseThemeChoiceId,
  parseThemeChoiceName,
  THEME_REFRESH_PROMPT,
  THEME_SAMPLE_HTML_MAX_CHARS,
  themeFontPairingSchema,
  themeProposalRequestSchema,
} from './agent-themes.ts'

const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Theme</title>
<style>html,body{margin:0;height:100%;} .slide{width:100vw;height:100vh;}</style>
</head>
<body><section class="slide"><h1>Title</h1></section></body>
</html>`

describe('agent themes', () => {
  it('validates four structured theme candidates and formats the choice', () => {
    const request = exampleThemeProposal()
    expect(request.themes).toHaveLength(4)
    expect(request.themes[0]?.theme.colors.canvas).toMatch(/^#[0-9a-f]{6}$/)
    expect(request.themes[0]?.fonts).toEqual(request.themes[0]?.theme.fonts)

    const formatted = formatThemeChoice(request, 'midnight')
    expect(formatted).toContain('Pick a visual direction: theme choice:')
    expect(formatted).toContain('Midnight Editorial (id: midnight)')
    expect(formatted).toContain('- Fonts: display georgia, body calibri, mono courier-new')
    expect(formatted).toContain('- Colors:')
    expect(formatted).toContain('- Recipes:')
    expect(parseThemeChoiceId(formatted)).toBe('midnight')
    expect(parseThemeChoiceName(request, formatted)).toBe('Midnight Editorial')
    expect(parseThemeChoiceFonts(formatted)).toEqual({
      display: 'georgia',
      body: 'calibri',
      mono: 'courier-new',
    })
  })

  it('formats an overridden font pairing on the theme choice', () => {
    const request = exampleThemeProposal()
    const theme = {
      ...request.themes[0]!.theme,
      fonts: { display: 'cambria' as const, body: 'arial' as const, mono: 'courier-new' as const },
    }
    const formatted = formatThemeChoice(request, 'midnight', theme.fonts, theme)
    expect(formatted).toContain('- Fonts: display cambria, body arial, mono courier-new')
    expect(parseThemeChoiceId(formatted)).toBe('midnight')
  })

  it('rejects proposals that are not exactly four themes', () => {
    const request = exampleThemeProposal()
    expect(
      themeProposalRequestSchema.safeParse({
        title: 'Pick a visual direction',
        themes: request.themes.slice(0, 1),
      }).success,
    ).toBe(false)
  })

  it('rejects duplicate fingerprints and oversized samples', () => {
    const request = exampleThemeProposal()
    const clone = {
      ...request.themes[1]!,
      id: 'copy',
      name: 'Copy',
      theme: request.themes[0]!.theme,
      fonts: request.themes[0]!.fonts,
      sampleHtml: request.themes[0]!.sampleHtml,
    }
    expect(
      themeProposalRequestSchema.safeParse({
        title: request.title,
        themes: [request.themes[0]!, clone, request.themes[2]!, request.themes[3]!],
      }).success,
    ).toBe(false)

    const oversized = `${request.themes[0]!.sampleHtml}${'x'.repeat(THEME_SAMPLE_HTML_MAX_CHARS)}`
    expect(
      themeProposalRequestSchema.safeParse({
        title: request.title,
        themes: request.themes.map((theme, index) =>
          index === 0 ? { ...theme, sampleHtml: oversized } : theme,
        ),
      }).success,
    ).toBe(false)
  })

  it('backfills default fonts when replaying persisted font-only proposals', () => {
    const parsed = parseStoredThemeProposalRequest({
      title: 'Pick a visual direction',
      themes: [
        { id: 'midnight', name: 'Midnight Editorial', description: 'Dark', sampleHtml },
        { id: 'sunlit', name: 'Sunlit Studio', description: 'Warm', sampleHtml },
        { id: 'signal', name: 'Signal Grid', description: 'Bold', sampleHtml },
        { id: 'folio', name: 'Quiet Folio', description: 'Soft', sampleHtml },
      ],
    })

    expect(parsed?.themes.every((theme) => theme.fonts === DEFAULT_THEME_FONT_PAIRING)).toBe(true)
    expect(parsed?.themes.every((theme) => theme.theme === undefined)).toBe(true)
    expect(themeProposalRequestSchema.safeParse(parsed).success).toBe(false)
  })

  it('replays stored structured proposals', () => {
    const request = exampleThemeProposal()
    const parsed = parseStoredThemeProposalRequest(request)
    expect(parsed?.themes[0]?.theme?.signature).toBe(exampleDeckThemes().midnight.signature)
    expect(themeProposalRequestSchema.safeParse(parsed).success).toBe(true)
  })

  it('rejects CSS stacks and unknown font ids', () => {
    expect(
      themeFontPairingSchema.safeParse({
        display: '"Georgia", "Gelasio", serif',
        body: 'calibri',
        mono: 'courier-new',
      }).success,
    ).toBe(false)
    expect(
      themeFontPairingSchema.safeParse({
        display: 'inter',
        body: 'calibri',
        mono: 'courier-new',
      }).success,
    ).toBe(false)
    expect(
      themeFontPairingSchema.safeParse({
        display: 'georgia',
        body: 'calibri',
      }).success,
    ).toBe(false)
    expect(deckFontIdSchema.safeParse('Calibri').success).toBe(false)
  })

  it('accepts every approved deck font id in each role', () => {
    expect([...APPROVED_DECK_FONT_IDS]).toEqual([
      'calibri',
      'arial',
      'cambria',
      'georgia',
      'times-new-roman',
      'courier-new',
    ])
    for (const id of APPROVED_DECK_FONT_IDS) {
      expect(deckFontIdSchema.parse(id)).toBe(id)
      expect(
        themeFontPairingSchema.parse({
          display: id,
          body: id,
          mono: id,
        }),
      ).toEqual({ display: id, body: id, mono: id })
    }
  })

  it('recognizes a request for different suggestions', () => {
    expect(isThemeRefreshContent(THEME_REFRESH_PROMPT)).toBe(true)
    expect(isThemeRefreshContent('use midnight')).toBe(false)
  })
})
