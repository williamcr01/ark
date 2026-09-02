import { z } from 'zod'

import { utf8ByteLength } from '@ark/deck/document/utf8.ts'
import {
  DEFAULT_DECK_THEME_FONT_PAIRING,
  buildThemeSampleHtml,
  deckFontIdSchema,
  deckThemeFontPairingSchema,
  deckThemeSpecV1Schema,
  exampleDeckThemes,
  formatDeckThemeSummary,
  type DeckThemeFontPairing,
  type DeckThemeSpecV1,
} from '@ark/deck/document/theme.ts'

export {
  deckFontIdSchema,
  DEFAULT_DECK_THEME_FONT_PAIRING as DEFAULT_THEME_FONT_PAIRING,
  deckThemeFontPairingSchema as themeFontPairingSchema,
  formatDeckThemeSummary,
}

export type ThemeFontPairing = DeckThemeFontPairing
export type { DeckThemeSpecV1 }

/** Per-sample budget for a three-slide demonstration. */
export const THEME_SAMPLE_HTML_MAX_BYTES = 8 * 1024
/** Character max aligned with the byte budget for ASCII-heavy HTML samples. */
export const THEME_SAMPLE_HTML_MAX_CHARS = THEME_SAMPLE_HTML_MAX_BYTES
/** Whole proposal, four samples plus specs, kept under the 50 KiB transcript cap. */
export const THEME_PROPOSAL_MAX_BYTES = 48 * 1024

export const THEME_REFRESH_PROMPT = 'Please suggest four different theme directions.'

const themeCandidateBaseSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(200),
  rationale: z
    .string()
    .min(1)
    .max(200)
    .describe('Why this direction suits the deck, audience, and content.'),
  theme: deckThemeSpecV1Schema.describe(
    'Durable design contract: fonts, colors, type, spacing, and slide recipes.',
  ),
  sampleHtml: z
    .string()
    .min(1)
    .max(THEME_SAMPLE_HTML_MAX_CHARS)
    .describe(
      'Complete self-contained three-slide HTML document (cover, content, and one of section/data/closing). Inline CSS using --ark-* variables, no external URLs. Keep lean (max ~8 KiB).',
    ),
})

export const themeCandidateSchema = themeCandidateBaseSchema.extend({
  fonts: deckThemeFontPairingSchema.describe(
    'Font pairing for this theme. Must match theme.fonts. Registry ids only.',
  ),
})

export const themeProposalRequestObjectSchema = z.object({
  title: z.string().min(1).max(120),
  themes: z.array(themeCandidateSchema).length(4),
})

export const themeProposalRequestSchema = themeProposalRequestObjectSchema.superRefine(
  (value, ctx) => {
    const ids = value.themes.map((theme) => theme.id)
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Theme ids must be unique.', path: ['themes'] })
    }

    const signatures = value.themes.map((theme) => theme.theme.signature)
    if (new Set(signatures).size !== signatures.length) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Themes must differ in palette, fonts, or layout recipes. Four near-identical options are not allowed.',
        path: ['themes'],
      })
    }

    for (const [index, theme] of value.themes.entries()) {
      if (
        theme.fonts.display !== theme.theme.fonts.display ||
        theme.fonts.body !== theme.theme.fonts.body ||
        theme.fonts.mono !== theme.theme.fonts.mono
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'fonts must match theme.fonts.',
          path: ['themes', index, 'fonts'],
        })
      }
      if (utf8ByteLength(theme.sampleHtml) > THEME_SAMPLE_HTML_MAX_BYTES) {
        ctx.addIssue({
          code: 'custom',
          message: `sampleHtml exceeds ${THEME_SAMPLE_HTML_MAX_BYTES} bytes.`,
          path: ['themes', index, 'sampleHtml'],
        })
      }
    }

    if (utf8ByteLength(JSON.stringify(value)) > THEME_PROPOSAL_MAX_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `Theme proposal exceeds ${THEME_PROPOSAL_MAX_BYTES} bytes.`,
        path: ['themes'],
      })
    }
  },
)

const legacyThemeCandidateSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_-]+$/),
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(200),
    rationale: z.string().min(1).max(200).optional(),
    theme: deckThemeSpecV1Schema.optional(),
    fonts: deckThemeFontPairingSchema.optional(),
    sampleHtml: z
      .string()
      .min(1)
      .max(12 * 1024),
  })
  .transform((candidate) => ({
    ...candidate,
    fonts: candidate.fonts ?? candidate.theme?.fonts ?? DEFAULT_DECK_THEME_FONT_PAIRING,
    rationale: candidate.rationale ?? candidate.description,
  }))

/** Lenient parser for persisted tool-call input that predates the full theme contract. */
export const themeProposalRequestStoredSchema = z.object({
  title: z.string().min(1).max(120),
  themes: z.array(legacyThemeCandidateSchema).length(4),
})

export type ThemeCandidate = z.infer<typeof themeCandidateSchema>
export type ThemeProposalRequest = z.infer<typeof themeProposalRequestSchema>
export type StoredThemeProposalRequest = z.infer<typeof themeProposalRequestStoredSchema>

export type ThemeSelection = {
  themeId: string
  name: string
  fonts: ThemeFontPairing
  theme: DeckThemeSpecV1 | null
}

export function parseStoredThemeProposalRequest(input: unknown): StoredThemeProposalRequest | null {
  const parsed = themeProposalRequestStoredSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

export function formatThemeFontPairingLine(fonts: ThemeFontPairing) {
  return `- Fonts: display ${fonts.display}, body ${fonts.body}, mono ${fonts.mono}`
}

export function formatThemeChoice(
  request: {
    title: string
    themes: Array<{
      id: string
      name: string
      fonts?: ThemeFontPairing
      theme?: DeckThemeSpecV1 | null
    }>
  },
  themeId: string,
  fonts?: ThemeFontPairing,
  theme?: DeckThemeSpecV1 | null,
) {
  const entry = request.themes.find((item) => item.id === themeId)
  const name = entry?.name ?? themeId
  const resolvedTheme = theme ?? entry?.theme ?? null
  const pairing = fonts ?? resolvedTheme?.fonts ?? entry?.fonts
  const lines = [`${request.title}: theme choice:`, `- Theme: ${name} (id: ${themeId})`]
  if (resolvedTheme) {
    lines.push(formatDeckThemeSummary(resolvedTheme))
  } else if (pairing) {
    lines.push(formatThemeFontPairingLine(pairing))
  }
  return lines.join('\n')
}

export function isThemeRefreshContent(content: string) {
  return content.trim() === THEME_REFRESH_PROMPT
}

/** Recover the chosen theme id from a formatted choice message. */
export function parseThemeChoiceId(content: string): string | null {
  const match = content.match(/\(id:\s*([a-z0-9_-]+)\)\s*$/m)
  return match?.[1] ?? null
}

export function parseThemeChoiceFonts(content: string): ThemeFontPairing | null {
  const match = content.match(/- Fonts: display ([a-z0-9-]+), body ([a-z0-9-]+), mono ([a-z0-9-]+)/)
  if (!match) return null
  const parsed = deckThemeFontPairingSchema.safeParse({
    display: match[1],
    body: match[2],
    mono: match[3],
  })
  return parsed.success ? parsed.data : null
}

export function parseThemeChoiceName(
  request: { themes: Array<{ id: string; name: string }> },
  content: string,
): string | null {
  const themeId = parseThemeChoiceId(content)
  if (!themeId) return null
  return request.themes.find((theme) => theme.id === themeId)?.name ?? themeId
}

export function exampleThemeProposal(title = 'Pick a visual direction'): ThemeProposalRequest {
  const examples = exampleDeckThemes()
  return themeProposalRequestSchema.parse({
    title,
    themes: [
      {
        id: 'midnight',
        name: 'Midnight Editorial',
        description: 'Dark, serif-led, high contrast',
        rationale: 'Editorial night palette for a serious, high-contrast first draft.',
        theme: examples.midnight,
        fonts: examples.midnight.fonts,
        sampleHtml: buildThemeSampleHtml(examples.midnight, { extraKind: 'data' }),
      },
      {
        id: 'sunlit',
        name: 'Sunlit Studio',
        description: 'Warm neutrals, airy type',
        rationale: 'Warm paper and open spacing for a conversational studio feel.',
        theme: examples.sunlit,
        fonts: examples.sunlit.fonts,
        sampleHtml: buildThemeSampleHtml(examples.sunlit, { extraKind: 'section' }),
      },
      {
        id: 'signal',
        name: 'Signal Grid',
        description: 'Bold sans, sharp accent',
        rationale: 'Cool canvas and a clear accent for data-led product stories.',
        theme: examples.signal,
        fonts: examples.signal.fonts,
        sampleHtml: buildThemeSampleHtml(examples.signal, { extraKind: 'data' }),
      },
      {
        id: 'folio',
        name: 'Quiet Folio',
        description: 'Soft paper, restrained palette',
        rationale: 'Quiet paper tones when the content should feel collected, not loud.',
        theme: examples.folio,
        fonts: examples.folio.fonts,
        sampleHtml: buildThemeSampleHtml(examples.folio, { extraKind: 'closing' }),
      },
    ],
  })
}

export function resolveThemeSelection(
  request: StoredThemeProposalRequest | ThemeProposalRequest,
  themeId: string,
  overrides?: { fonts?: ThemeFontPairing; theme?: DeckThemeSpecV1 | null },
): ThemeSelection | null {
  const entry = request.themes.find((theme) => theme.id === themeId)
  if (!entry) return null
  const theme = overrides?.theme ?? entry.theme ?? null
  const fonts = overrides?.fonts ?? theme?.fonts ?? entry.fonts
  return {
    themeId,
    name: entry.name,
    fonts,
    theme,
  }
}
