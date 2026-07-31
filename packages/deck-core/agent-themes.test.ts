import { describe, expect, it } from 'vitest'

import {
  formatThemeChoice,
  parseThemeChoiceId,
  parseThemeChoiceName,
  THEME_SAMPLE_HTML_MAX_CHARS,
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
  it('validates four theme candidates and formats the choice for chat', () => {
    const request = themeProposalRequestSchema.parse({
      title: 'Pick a visual direction',
      themes: [
        {
          id: 'midnight',
          name: 'Midnight Editorial',
          description: 'Dark, serif-led, high contrast',
          sampleHtml,
        },
        {
          id: 'sunlit',
          name: 'Sunlit Studio',
          description: 'Warm neutrals, airy type',
          sampleHtml,
        },
        {
          id: 'signal',
          name: 'Signal Grid',
          description: 'Bold sans, sharp accent',
          sampleHtml,
        },
        {
          id: 'folio',
          name: 'Quiet Folio',
          description: 'Soft paper, restrained palette',
          sampleHtml,
        },
      ],
    })

    const formatted = formatThemeChoice(request, 'midnight')
    expect(formatted).toContain('Pick a visual direction — theme choice:')
    expect(formatted).toContain('Midnight Editorial (id: midnight)')
    expect(parseThemeChoiceId(formatted)).toBe('midnight')
    expect(parseThemeChoiceName(request, formatted)).toBe('Midnight Editorial')
  })

  it('rejects proposals that are not exactly four themes', () => {
    expect(
      themeProposalRequestSchema.safeParse({
        title: 'Pick a visual direction',
        themes: [
          {
            id: 'only',
            name: 'Only One',
            description: 'Not enough options',
            sampleHtml,
          },
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
          {
            id: 'midnight',
            name: 'Midnight Editorial',
            description: 'Dark',
            sampleHtml: oversized,
          },
          {
            id: 'sunlit',
            name: 'Sunlit Studio',
            description: 'Warm',
            sampleHtml,
          },
          {
            id: 'signal',
            name: 'Signal Grid',
            description: 'Bold',
            sampleHtml,
          },
          {
            id: 'folio',
            name: 'Quiet Folio',
            description: 'Soft',
            sampleHtml,
          },
        ],
      }).success,
    ).toBe(false)
  })
})
