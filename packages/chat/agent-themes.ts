import { z } from 'zod'

import { APPROVED_DECK_FONT_IDS } from '@ark/runtime-registry/deck-font-registry.ts'

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

export const themeCandidateSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(200),
  fonts: themeFontPairingSchema.describe(
    'Font pairing for this theme. Registry ids only (for example georgia, calibri, courier-new). Apply the same pairing in sampleHtml with data-ark-font-* markers.',
  ),
  sampleHtml: z
    .string()
    .min(1)
    .max(THEME_SAMPLE_HTML_MAX_CHARS)
    .describe(
      'Complete self-contained single-slide HTML document (inline CSS, no external URLs). Keep lean (max ~10 KiB).',
    ),
})

export const themeProposalRequestSchema = z.object({
  title: z.string().min(1).max(120),
  themes: z.array(themeCandidateSchema).length(4),
})

export type ThemeFontPairing = z.infer<typeof themeFontPairingSchema>
export type ThemeCandidate = z.infer<typeof themeCandidateSchema>
export type ThemeProposalRequest = z.infer<typeof themeProposalRequestSchema>

export function formatThemeChoice(request: ThemeProposalRequest, themeId: string) {
  const theme = request.themes.find((entry) => entry.id === themeId)
  const name = theme?.name ?? themeId
  return `${request.title}: theme choice:\n- Theme: ${name} (id: ${themeId})`
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
