import type { ThemeFontPairing } from '@ark/chat/agent-themes.ts'
import {
  APPROVED_DECK_FONTS,
  DECK_FONT_ROLES,
  getDeckFont,
  type DeckFontId,
  type DeckFontRole,
} from '@ark/runtime-registry/deck-font-registry.ts'

export const THEME_FONT_ROLE_LABELS: Record<DeckFontRole, string> = {
  display: 'Display',
  body: 'Body',
  mono: 'Mono',
}

export function themeFontRoleOptions() {
  return APPROVED_DECK_FONTS.map((font) => ({ id: font.id, label: font.label }))
}

export function themeFontLabel(id: DeckFontId) {
  return getDeckFont(id)?.label ?? id
}

/** Compact pairing shown on a theme card, e.g. "Georgia · Calibri · Courier New". */
export function formatThemeFontPairingLabel(fonts: ThemeFontPairing) {
  return DECK_FONT_ROLES.map((role) => themeFontLabel(fonts[role])).join(' · ')
}

export function isThemeFontId(value: string): value is DeckFontId {
  return APPROVED_DECK_FONTS.some((font) => font.id === value)
}

export function resolveThemeFontPairing(
  fonts: ThemeFontPairing,
  role: DeckFontRole,
  nextId: string,
): ThemeFontPairing {
  if (!isThemeFontId(nextId)) return fonts
  return { ...fonts, [role]: nextId }
}
