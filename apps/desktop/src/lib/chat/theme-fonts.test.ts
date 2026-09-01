import { describe, expect, it } from 'vitest'

import { DECK_FONT_ROLES } from '@ark/runtime-registry/deck-font-registry.ts'

import {
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
})
