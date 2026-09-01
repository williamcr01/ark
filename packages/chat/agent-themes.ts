import { z } from 'zod'

import {
  APPROVED_DECK_FONT_IDS,
  DEFAULT_DECK_FONT_IDS,
} from '@ark/runtime-registry/deck-font-registry.ts'

/** Per-sample budget kept under the 50 KiB transcript value cap for 4 themes. */
export const THEME_SAMPLE_HTML_MAX_BYTES = 10 * 1024
/** Character max aligned with the byte budget for ASCII-heavy HTML samples. */
export const THEME_SAMPLE_HTML_MAX_CHARS = THEME_SAMPLE_HTML_MAX_BYTES

export const deckFontIdSchema = z
  .enum(APPROVED_DECK_FONT_IDS)
  .describe('Approved deck font id from the registry, not a CSS stack.')

export const themeFontPairingSchema = z.object({
  display: deckFontIdSchema,
  body: deckFontIdSchema,
  mono: deckFontIdSchema,
})

export type ThemeFontPairing = z.infer<typeof themeFontPairingSchema>

export const DEFAULT_THEME_FONT_PAIRING: ThemeFontPairing = {
  display: DEFAULT_DECK_FONT_IDS.display,
  body: DEFAULT_DECK_FONT_IDS.body,
  mono: DEFAULT_DECK_FONT_IDS.mono,
}

const themeCandidateBaseSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(200),
  sampleHtml: z
    .string()
    .min(1)
    .max(THEME_SAMPLE_HTML_MAX_CHARS)
    .describe(
      'Complete self-contained single-slide HTML document (inline CSS, no external URLs). Keep lean (max ~10 KiB).',
    ),
})

export const themeCandidateSchema = themeCandidateBaseSchema.extend({
  fonts: themeFontPairingSchema.describe(
    'Font pairing for this theme. Registry ids only (for example georgia, calibri, courier-new). Apply the same pairing in sampleHtml with data-ark-font-* markers.',
  ),
})

export const themeProposalRequestSchema = z.object({
  title: z.string().min(1).max(120),
  themes: z.array(themeCandidateSchema).length(4),
})

const themeCandidateStoredSchema = themeCandidateBaseSchema
  .extend({
    fonts: themeFontPairingSchema.optional(),
  })
  .transform((candidate) => ({
    ...candidate,
    fonts: candidate.fonts ?? DEFAULT_THEME_FONT_PAIRING,
  }))

/** Lenient parser for persisted tool-call input that predates the fonts contract. */
export const themeProposalRequestStoredSchema = z.object({
  title: z.string().min(1).max(120),
  themes: z.array(themeCandidateStoredSchema).length(4),
})

export type ThemeCandidate = z.infer<typeof themeCandidateSchema>
export type ThemeProposalRequest = z.infer<typeof themeProposalRequestSchema>

export function parseStoredThemeProposalRequest(input: unknown): ThemeProposalRequest | null {
  const parsed = themeProposalRequestStoredSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

export function formatThemeFontPairingLine(fonts: ThemeFontPairing) {
  return `- Fonts: display ${fonts.display}, body ${fonts.body}, mono ${fonts.mono}`
}

export function formatThemeChoice(
  request: ThemeProposalRequest,
  themeId: string,
  fonts?: ThemeFontPairing,
) {
  const theme = request.themes.find((entry) => entry.id === themeId)
  const name = theme?.name ?? themeId
  const pairing = fonts ?? theme?.fonts
  const lines = [`${request.title}: theme choice:`, `- Theme: ${name} (id: ${themeId})`]
  if (pairing) lines.push(formatThemeFontPairingLine(pairing))
  return lines.join('\n')
}

/** Recover the chosen theme id from a formatted choice message. */
export function parseThemeChoiceId(content: string): string | null {
  const match = content.match(/\(id:\s*([a-z0-9_-]+)\)\s*$/m)
  return match?.[1] ?? null
}

export function parseThemeChoiceName(
  request: ThemeProposalRequest,
  content: string,
): string | null {
  const themeId = parseThemeChoiceId(content)
  if (!themeId) return null
  return request.themes.find((theme) => theme.id === themeId)?.name ?? themeId
}
