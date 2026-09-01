import { describe, expect, it } from 'vitest'

import { APPROVED_DECK_FONT_IDS } from '@ark/runtime-registry/deck-font-registry.ts'

import {
  deckFontIdSchema,
  formatThemeChoice,
  parseThemeChoiceId,
  parseThemeChoiceName,
  THEME_SAMPLE_HTML_MAX_CHARS,
  themeCandidateSchema,
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

const fonts = {
  display: 'georgia',
  body: 'calibri',
  mono: 'courier-new',
} as const

function theme(partial: { id: string; name: string; description: string; sampleHtml?: string }) {
  return { fonts, sampleHtml, ...partial }
}

describe('agent themes', () => {
  it('validates four theme candidates and formats the choice for chat', () => {
    const request = themeProposalRequestSchema.parse({
      title: 'Pick a visual direction',
      themes: [
        theme({
          id: 'midnight',
          name: 'Midnight Editorial',
          description: 'Dark, serif-led, high contrast',
        }),
        theme({
          id: 'sunlit',
          name: 'Sunlit Studio',
          description: 'Warm neutrals, airy type',
        }),
        theme({
          id: 'signal',
          name: 'Signal Grid',
          description: 'Bold sans, sharp accent',
        }),
        theme({
          id: 'folio',
          name: 'Quiet Folio',
          description: 'Soft paper, restrained palette',
        }),
      ],
    })

    expect(request.themes[0]?.fonts).toEqual(fonts)
    const formatted = formatThemeChoice(request, 'midnight')
    expect(formatted).toContain('Pick a visual direction: theme choice:')
    expect(formatted).toContain('Midnight Editorial (id: midnight)')
    expect(parseThemeChoiceId(formatted)).toBe('midnight')
    expect(parseThemeChoiceName(request, formatted)).toBe('Midnight Editorial')
  })

  it('rejects proposals that are not exactly four themes', () => {
    expect(
      themeProposalRequestSchema.safeParse({
        title: 'Pick a visual direction',
        themes: [
          theme({
            id: 'only',
            name: 'Only One',
            description: 'Not enough options',
          }),
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects samples above the shared transcript budget', () => {
    const oversized = `${sampleHtml}${'x'.repeat(THEME_SAMPLE_HTML_MAX_CHARS)}`
    expect(
      themeProposalRequestSchema.safeParse({
        title: 'Pick a visual direction',
        themes: [
          theme({
            id: 'midnight',
            name: 'Midnight Editorial',
            description: 'Dark',
            sampleHtml: oversized,
          }),
          theme({
            id: 'sunlit',
            name: 'Sunlit Studio',
            description: 'Warm',
          }),
          theme({
            id: 'signal',
            name: 'Signal Grid',
            description: 'Bold',
          }),
          theme({
            id: 'folio',
            name: 'Quiet Folio',
            description: 'Soft',
          }),
        ],
      }).success,
    ).toBe(false)
  })

  it('requires a registry font pairing on every theme', () => {
    const parsed = themeCandidateSchema.safeParse({
      id: 'midnight',
      name: 'Midnight Editorial',
      description: 'Dark',
      sampleHtml,
    })

    expect(parsed.success).toBe(false)
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
    expect(deckFontIdSchema.safeParse('Calibri').success).toBe(false)
  })

  it('accepts every approved deck font id in each role', () => {
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
})
