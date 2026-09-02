import type { ThemeFontPairing } from '@ark/chat/agent-themes.ts'
import { applyDeckThemeToDocument, type DeckThemeSpecV1 } from '@ark/deck/document/theme.ts'
import {
  APPROVED_DECK_FONTS,
  buildDeckFontRootCss,
  DECK_FONT_MARKER_ATTRS,
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

/** Apply the selected registry pairing to a theme sample for preview. */
export function applyThemeFontPairingToSampleHtml(sampleHtml: string, fonts: ThemeFontPairing) {
  const doc = new DOMParser().parseFromString(sampleHtml, 'text/html')
  const root = doc.documentElement

  for (const role of DECK_FONT_ROLES) {
    root.setAttribute(DECK_FONT_MARKER_ATTRS[role], fonts[role])
  }

  const head = doc.head ?? doc.createElement('head')
  if (!doc.head) {
    root.insertBefore(head, root.firstChild)
  }

  head.querySelector('style[data-ark-theme-fonts]')?.remove()
  const style = doc.createElement('style')
  style.setAttribute('data-ark-theme-fonts', '')
  style.textContent = buildDeckFontRootCss(fonts)
  head.append(style)

  return `<!DOCTYPE html>\n${root.outerHTML}`
}

/** Apply the resolved theme contract to a sample for live preview. */
export function applyDeckThemeToSampleHtml(sampleHtml: string, theme: DeckThemeSpecV1) {
  const doc = new DOMParser().parseFromString(sampleHtml, 'text/html')
  applyDeckThemeToDocument(doc, theme)
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
}
