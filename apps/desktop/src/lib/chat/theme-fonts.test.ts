import { describe, expect, it } from 'vitest'

import { DECK_FONT_ROLES } from '@ark/runtime-registry/deck-font-registry.ts'

import {
  applyThemeFontPairingToSampleHtml,
  formatThemeFontPairingLabel,
  isThemeFontId,
  resolveThemeFontPairing,
  THEME_FONT_ROLE_LABELS,
  themeFontLabel,
  themeFontRoleOptions,
} from './theme-fonts'

const pairing = {
  display: 'georgia',
  body: 'calibri',
  mono: 'courier-new',
} as const

describe('theme font role mapping', () => {
  it('maps each contract role to a picker label and registry options', () => {
    expect(THEME_FONT_ROLE_LABELS).toEqual({
      display: 'Display',
      body: 'Body',
      mono: 'Mono',
    })
    expect(DECK_FONT_ROLES).toEqual(['display', 'body', 'mono'])

    const options = themeFontRoleOptions()
    expect(options.map((font) => font.id)).toEqual([
      'calibri',
      'arial',
      'cambria',
      'georgia',
      'times-new-roman',
      'courier-new',
    ])
    expect(options.find((font) => font.id === 'georgia')?.label).toBe('Georgia')
  })

  it('formats a theme pairing with registry labels, not CSS stacks', () => {
    expect(formatThemeFontPairingLabel(pairing)).toBe('Georgia · Calibri · Courier New')
    expect(themeFontLabel('times-new-roman')).toBe('Times New Roman')
  })

  it('updates one role only when the next id is in the registry', () => {
    expect(resolveThemeFontPairing(pairing, 'display', 'cambria')).toEqual({
      display: 'cambria',
      body: 'calibri',
      mono: 'courier-new',
    })
    expect(resolveThemeFontPairing(pairing, 'body', 'inter')).toEqual(pairing)
    expect(isThemeFontId('calibri')).toBe(true)
    expect(isThemeFontId('inter')).toBe(false)
  })

  it('injects font markers and root variables into theme sample HTML', () => {
    const sampleHtml =
      '<!DOCTYPE html><html lang="en"><head><title>Theme</title></head><body><section class="slide"><h1>Title</h1></section></body></html>'
    const html = applyThemeFontPairingToSampleHtml(sampleHtml, {
      display: 'cambria',
      body: 'calibri',
      mono: 'courier-new',
    })

    expect(html).toContain('data-ark-font-display="cambria"')
    expect(html).toContain('data-ark-font-body="calibri"')
    expect(html).toContain('data-ark-theme-fonts')
    expect(html).toContain('--ark-font-display')
  })
})
