import { z } from 'zod'

import {
  APPROVED_DECK_FONT_IDS,
  DEFAULT_DECK_FONT_IDS,
  DECK_FONT_CSS_VARS,
  DECK_FONT_MARKER_ATTRS,
  DECK_FONT_ROLES,
  buildDeckFontRootCss,
  type DeckFontId,
} from '@ark/runtime-registry/deck-font-registry.ts'

export const DECK_THEME_SCHEMA_VERSION = 1 as const

export const ARK_THEME_SCRIPT_TYPE = 'application/json'
export const ARK_THEME_ATTR = 'data-ark-theme'
export const ARK_THEME_VARS_ATTR = 'data-ark-theme-vars'
export const ARK_SLIDE_KIND_ATTR = 'data-ark-slide-kind'
export const ARK_SLIDE_LAYOUT_ATTR = 'data-ark-layout'

export const SLIDE_RECIPE_ROLES = ['cover', 'section', 'content', 'data', 'closing'] as const
export type SlideRecipeRole = (typeof SLIDE_RECIPE_ROLES)[number]

export const THEME_SAMPLE_REQUIRED_KINDS = ['cover', 'content'] as const
export const THEME_SAMPLE_OPTIONAL_KINDS = ['section', 'data', 'closing'] as const

export const DECK_THEME_COLOR_ROLES = [
  'canvas',
  'surface',
  'foreground',
  'muted',
  'primary',
  'secondary',
  'accent',
] as const
export type DeckThemeColorRole = (typeof DECK_THEME_COLOR_ROLES)[number]

export const DECK_THEME_COLOR_CSS_VARS: Record<DeckThemeColorRole, string> = {
  canvas: '--ark-color-canvas',
  surface: '--ark-color-surface',
  foreground: '--ark-color-foreground',
  muted: '--ark-color-muted',
  primary: '--ark-color-primary',
  secondary: '--ark-color-secondary',
  accent: '--ark-color-accent',
}

export const DECK_THEME_TYPE_CSS_VARS = {
  displayPx: '--ark-type-display',
  titlePx: '--ark-type-title',
  bodyPx: '--ark-type-body',
  captionPx: '--ark-type-caption',
} as const

export const DECK_THEME_SPACE_CSS_VARS = {
  pagePaddingPx: '--ark-space-page',
  sectionGapPx: '--ark-space-section',
  itemGapPx: '--ark-space-item',
  radiusPx: '--ark-radius',
} as const

export const REQUIRED_THEME_CSS_VARS = [
  ...Object.values(DECK_FONT_CSS_VARS),
  ...Object.values(DECK_THEME_COLOR_CSS_VARS),
  ...Object.values(DECK_THEME_TYPE_CSS_VARS),
  ...Object.values(DECK_THEME_SPACE_CSS_VARS),
] as const

const TEXT_CONTRAST_MIN = 4.5
const MUTED_CONTRAST_MIN = 3

export const deckFontIdSchema = z
  .enum(APPROVED_DECK_FONT_IDS)
  .describe('Approved deck font id from the registry, not a CSS stack.')

export const deckThemeFontPairingSchema = z.object({
  display: deckFontIdSchema,
  body: deckFontIdSchema,
  mono: deckFontIdSchema,
})

export type DeckThemeFontPairing = z.infer<typeof deckThemeFontPairingSchema>

export const DEFAULT_DECK_THEME_FONT_PAIRING: DeckThemeFontPairing = {
  display: DEFAULT_DECK_FONT_IDS.display,
  body: DEFAULT_DECK_FONT_IDS.body,
  mono: DEFAULT_DECK_FONT_IDS.mono,
}

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a six-digit hex color like #1a1a1a.')
  .transform((value) => value.toLowerCase())

export type HexColor = z.infer<typeof hexColorSchema>

export const deckThemeColorsSchema = z.object({
  canvas: hexColorSchema,
  surface: hexColorSchema,
  foreground: hexColorSchema,
  muted: hexColorSchema,
  primary: hexColorSchema,
  secondary: hexColorSchema,
  accent: hexColorSchema,
})

export type DeckThemeColors = z.infer<typeof deckThemeColorsSchema>

export const deckThemeTypographySchema = z.object({
  displayPx: z.number().int().min(40).max(96),
  titlePx: z.number().int().min(24).max(56),
  bodyPx: z.number().int().min(14).max(28),
  captionPx: z.number().int().min(11).max(18),
})

export type DeckThemeTypography = z.infer<typeof deckThemeTypographySchema>

export const deckThemeSpacingSchema = z.object({
  pagePaddingPx: z.number().int().min(24).max(96),
  sectionGapPx: z.number().int().min(8).max(64),
  itemGapPx: z.number().int().min(4).max(32),
  radiusPx: z.number().int().min(0).max(32),
})

export type DeckThemeSpacing = z.infer<typeof deckThemeSpacingSchema>

export const slideRecipeSchema = z.object({
  layout: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9-]{0,39}$/, 'Layout slugs use lowercase letters, digits, and hyphens.'),
  rules: z.array(z.string().min(1).max(160)).min(1).max(3),
})

export type SlideRecipe = z.infer<typeof slideRecipeSchema>

export const deckThemeSlideRecipesSchema = z.object({
  cover: slideRecipeSchema,
  section: slideRecipeSchema,
  content: slideRecipeSchema,
  data: slideRecipeSchema,
  closing: slideRecipeSchema,
})

export type DeckThemeSlideRecipes = z.infer<typeof deckThemeSlideRecipesSchema>

const deckThemeSpecFieldsSchema = z.object({
  schemaVersion: z.literal(DECK_THEME_SCHEMA_VERSION),
  fonts: deckThemeFontPairingSchema,
  colors: deckThemeColorsSchema,
  typography: deckThemeTypographySchema,
  spacing: deckThemeSpacingSchema,
  slideRecipes: deckThemeSlideRecipesSchema,
  signature: z.string().min(1).max(64).optional(),
})

export type DeckThemeContrastIssue = {
  path: string
  message: string
}

export function deckThemeContrastIssues(colors: DeckThemeColors): DeckThemeContrastIssue[] {
  const issues: DeckThemeContrastIssue[] = []
  const pairs: Array<{
    fg: DeckThemeColorRole
    bg: DeckThemeColorRole
    min: number
    label: string
  }> = [
    { fg: 'foreground', bg: 'canvas', min: TEXT_CONTRAST_MIN, label: 'Foreground on canvas' },
    { fg: 'foreground', bg: 'surface', min: TEXT_CONTRAST_MIN, label: 'Foreground on surface' },
    { fg: 'muted', bg: 'canvas', min: MUTED_CONTRAST_MIN, label: 'Muted text on canvas' },
    { fg: 'muted', bg: 'surface', min: MUTED_CONTRAST_MIN, label: 'Muted text on surface' },
  ]

  for (const pair of pairs) {
    const ratio = contrastRatio(colors[pair.fg], colors[pair.bg])
    if (ratio < pair.min) {
      issues.push({
        path: `colors.${pair.fg}`,
        message: `${pair.label} contrast is ${ratio.toFixed(2)}:1; need at least ${pair.min}:1.`,
      })
    }
  }

  return issues
}

export type DeckThemeSpecInput = z.infer<typeof deckThemeSpecFieldsSchema>

export type DeckThemeSpecV1 = Omit<DeckThemeSpecInput, 'signature'> & {
  signature: string
}

export const deckThemeSpecV1Schema = deckThemeSpecFieldsSchema
  .superRefine((value, ctx) => {
    for (const issue of deckThemeContrastIssues(value.colors)) {
      ctx.addIssue({
        code: 'custom',
        path: issue.path.split('.'),
        message: issue.message,
      })
    }
  })
  .transform((value): DeckThemeSpecV1 => {
    const { signature: _ignored, ...rest } = value
    return { ...rest, signature: deckThemeSignature(rest) }
  })

export const DEFAULT_DECK_THEME_TYPOGRAPHY: DeckThemeTypography = {
  displayPx: 64,
  titlePx: 36,
  bodyPx: 18,
  captionPx: 13,
}

export const DEFAULT_DECK_THEME_SPACING: DeckThemeSpacing = {
  pagePaddingPx: 56,
  sectionGapPx: 28,
  itemGapPx: 12,
  radiusPx: 8,
}

const EXAMPLE_RECIPES: Record<string, DeckThemeSlideRecipes> = {
  midnight: {
    cover: { layout: 'split-title', rules: ['Display title left, supporting line right.'] },
    section: { layout: 'band-header', rules: ['Full-width label band, then title.'] },
    content: { layout: 'two-column', rules: ['Heading plus two equal body columns.'] },
    data: { layout: 'number-grid', rules: ['Three metric tiles, caption under each.'] },
    closing: { layout: 'centered-close', rules: ['Centered closer, one next-step line.'] },
  },
  sunlit: {
    cover: { layout: 'stacked-hero', rules: ['Title stacked over a short deck promise.'] },
    section: { layout: 'oversized-numeral', rules: ['Giant section number, small label.'] },
    content: { layout: 'stacked-blocks', rules: ['Single column, generous vertical rhythm.'] },
    data: { layout: 'chart-left', rules: ['Chart or table left, takeaway right.'] },
    closing: { layout: 'recap-list', rules: ['Three recap lines, quiet closer.'] },
  },
  signal: {
    cover: { layout: 'editorial-masthead', rules: ['Eyebrow, huge title, thin rule.'] },
    section: { layout: 'full-bleed-label', rules: ['Accent band with section name only.'] },
    content: { layout: 'pull-quote-rail', rules: ['Body left, quote or callout rail right.'] },
    data: { layout: 'table-first', rules: ['Primary table or grid, caption below.'] },
    closing: { layout: 'next-step', rules: ['One action, supporting contact line.'] },
  },
  folio: {
    cover: { layout: 'centered-title', rules: ['Centered title on paper-like canvas.'] },
    section: { layout: 'quiet-rule', rules: ['Small caps label above a hairline.'] },
    content: { layout: 'asymmetric-split', rules: ['Wide text column, narrow aside.'] },
    data: { layout: 'captioned-figure', rules: ['Figure first, caption and source.'] },
    closing: { layout: 'colophon', rules: ['Small centered thanks and date.'] },
  },
}

export function exampleDeckThemes() {
  return {
    midnight: createDeckThemeSpec({
      fonts: { display: 'georgia', body: 'calibri', mono: 'courier-new' },
      colors: {
        canvas: '#111111',
        surface: '#1c1c1c',
        foreground: '#f4f1ea',
        muted: '#b8b2a8',
        primary: '#c4a574',
        secondary: '#8a7a68',
        accent: '#e8dcc8',
      },
      slideRecipes: EXAMPLE_RECIPES.midnight!,
    }),
    sunlit: createDeckThemeSpec({
      fonts: { display: 'cambria', body: 'arial', mono: 'courier-new' },
      colors: {
        canvas: '#f7f3eb',
        surface: '#ffffff',
        foreground: '#1a1814',
        muted: '#6b645c',
        primary: '#9a4d2e',
        secondary: '#3f5d4e',
        accent: '#c47a3a',
      },
      slideRecipes: EXAMPLE_RECIPES.sunlit!,
    }),
    signal: createDeckThemeSpec({
      fonts: { display: 'arial', body: 'calibri', mono: 'courier-new' },
      colors: {
        canvas: '#0e1116',
        surface: '#171c24',
        foreground: '#eef2f7',
        muted: '#9aa4b2',
        primary: '#3d8bfd',
        secondary: '#5eead4',
        accent: '#f5c542',
      },
      slideRecipes: EXAMPLE_RECIPES.signal!,
    }),
    folio: createDeckThemeSpec({
      fonts: { display: 'times-new-roman', body: 'georgia', mono: 'courier-new' },
      colors: {
        canvas: '#f4f1ea',
        surface: '#fffdf8',
        foreground: '#222018',
        muted: '#6f6a60',
        primary: '#2f5d50',
        secondary: '#8c6a3f',
        accent: '#b5523a',
      },
      slideRecipes: EXAMPLE_RECIPES.folio!,
    }),
  }
}

export function createDeckThemeSpec(input: {
  fonts?: DeckThemeFontPairing
  colors: DeckThemeColors
  typography?: Partial<DeckThemeTypography>
  spacing?: Partial<DeckThemeSpacing>
  slideRecipes: DeckThemeSlideRecipes
}): DeckThemeSpecV1 {
  return deckThemeSpecV1Schema.parse({
    schemaVersion: DECK_THEME_SCHEMA_VERSION,
    fonts: input.fonts ?? DEFAULT_DECK_THEME_FONT_PAIRING,
    colors: input.colors,
    typography: { ...DEFAULT_DECK_THEME_TYPOGRAPHY, ...input.typography },
    spacing: { ...DEFAULT_DECK_THEME_SPACING, ...input.spacing },
    slideRecipes: input.slideRecipes,
  })
}

export function patchDeckTheme(
  theme: DeckThemeSpecV1,
  patch: {
    fonts?: DeckThemeFontPairing
    colors?: DeckThemeColors
    typography?: Partial<DeckThemeTypography>
    spacing?: Partial<DeckThemeSpacing>
  },
): DeckThemeSpecV1 {
  const next = {
    ...theme,
    fonts: patch.fonts ?? theme.fonts,
    colors: patch.colors ?? theme.colors,
    typography: { ...theme.typography, ...patch.typography },
    spacing: { ...theme.spacing, ...patch.spacing },
  }
  return { ...next, signature: deckThemeSignature(next) }
}

export function deckThemeSignature(
  theme: Omit<DeckThemeSpecV1, 'signature'> | DeckThemeSpecV1,
): string {
  const payload = JSON.stringify({
    fonts: theme.fonts,
    colors: theme.colors,
    layouts: Object.fromEntries(
      SLIDE_RECIPE_ROLES.map((role) => [role, theme.slideRecipes[role].layout]),
    ),
  })
  return `t1-${fnv1aHex(payload)}`
}

export function isSlideRecipeRole(value: string | null | undefined): value is SlideRecipeRole {
  return Boolean(value && (SLIDE_RECIPE_ROLES as readonly string[]).includes(value))
}

export function buildDeckThemeRootCss(theme: DeckThemeSpecV1) {
  const fontBlock = buildDeckFontRootCss(theme.fonts)
  const extra = [
    ...DECK_THEME_COLOR_ROLES.map(
      (role) => `  ${DECK_THEME_COLOR_CSS_VARS[role]}: ${theme.colors[role]};`,
    ),
    `  ${DECK_THEME_TYPE_CSS_VARS.displayPx}: ${theme.typography.displayPx}px;`,
    `  ${DECK_THEME_TYPE_CSS_VARS.titlePx}: ${theme.typography.titlePx}px;`,
    `  ${DECK_THEME_TYPE_CSS_VARS.bodyPx}: ${theme.typography.bodyPx}px;`,
    `  ${DECK_THEME_TYPE_CSS_VARS.captionPx}: ${theme.typography.captionPx}px;`,
    `  ${DECK_THEME_SPACE_CSS_VARS.pagePaddingPx}: ${theme.spacing.pagePaddingPx}px;`,
    `  ${DECK_THEME_SPACE_CSS_VARS.sectionGapPx}: ${theme.spacing.sectionGapPx}px;`,
    `  ${DECK_THEME_SPACE_CSS_VARS.itemGapPx}: ${theme.spacing.itemGapPx}px;`,
    `  ${DECK_THEME_SPACE_CSS_VARS.radiusPx}: ${theme.spacing.radiusPx}px;`,
  ].join('\n')

  return fontBlock.replace(/\n\}$/, `\n${extra}\n}`)
}

export function serializeDeckThemeSpec(theme: DeckThemeSpecV1) {
  return JSON.stringify(deckThemeSpecV1Schema.parse(theme))
}

export function parseDeckThemeSpec(input: unknown): DeckThemeSpecV1 | null {
  const parsed = deckThemeSpecV1Schema.safeParse(input)
  return parsed.success ? parsed.data : null
}

export function isInertArkThemeScript(script: Element) {
  const type = (script.getAttribute('type') ?? '').trim().toLowerCase()
  return type === ARK_THEME_SCRIPT_TYPE && script.hasAttribute(ARK_THEME_ATTR)
}

export function readDeckThemeFromDocument(doc: Document): DeckThemeSpecV1 | null {
  const script = doc.querySelector(`script[type="${ARK_THEME_SCRIPT_TYPE}"][${ARK_THEME_ATTR}]`)
  const raw = script?.textContent?.trim()
  if (!raw) return null
  try {
    return parseDeckThemeSpec(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function readSlideRecipe(element: Element): {
  kind: SlideRecipeRole | null
  layout: string | null
} {
  const kindAttr = element.getAttribute(ARK_SLIDE_KIND_ATTR)?.trim() ?? null
  return {
    kind: isSlideRecipeRole(kindAttr) ? kindAttr : null,
    layout: element.getAttribute(ARK_SLIDE_LAYOUT_ATTR)?.trim() || null,
  }
}

export function applyDeckThemeToDocument(doc: Document, theme: DeckThemeSpecV1) {
  const root = doc.documentElement
  if (!root) return

  for (const role of DECK_FONT_ROLES) {
    root.setAttribute(DECK_FONT_MARKER_ATTRS[role], theme.fonts[role])
  }

  let head = doc.head
  if (!head) {
    head = doc.createElement('head')
    root.insertBefore(head, root.firstChild)
  }

  head.querySelector(`style[${ARK_THEME_VARS_ATTR}]`)?.remove()
  const style = doc.createElement('style')
  style.setAttribute(ARK_THEME_VARS_ATTR, '')
  style.textContent = buildDeckThemeRootCss(theme)
  head.append(style)
}

export type DeckThemeIssue = {
  code: string
  message: string
}

export function inspectThemeSample(doc: Document, theme: DeckThemeSpecV1): DeckThemeIssue[] {
  const issues: DeckThemeIssue[] = []
  const slides = findThemeSampleSlides(doc)

  if (slides.length !== 3) {
    issues.push({
      code: 'sample_slide_count',
      message: `Theme sample must contain exactly 3 slides; found ${slides.length}.`,
    })
  }

  const kinds = slides.map((slide) => slide.getAttribute(ARK_SLIDE_KIND_ATTR)?.trim() ?? '')
  for (const required of THEME_SAMPLE_REQUIRED_KINDS) {
    if (!kinds.includes(required)) {
      issues.push({
        code: 'sample_missing_kind',
        message: `Theme sample is missing a ${required} slide.`,
      })
    }
  }

  const optionalCount = THEME_SAMPLE_OPTIONAL_KINDS.filter((kind) => kinds.includes(kind)).length
  if (optionalCount !== 1) {
    issues.push({
      code: 'sample_optional_kind',
      message:
        'Theme sample needs exactly one of section, data, or closing besides cover and content.',
    })
  }

  for (const slide of slides) {
    const { kind, layout } = readSlideRecipe(slide)
    if (!kind) {
      issues.push({
        code: 'sample_unclassified',
        message: 'Every sample slide needs data-ark-slide-kind set to a known recipe role.',
      })
      continue
    }
    const expectedLayout = theme.slideRecipes[kind].layout
    if (layout !== expectedLayout) {
      issues.push({
        code: 'sample_layout',
        message: `${kind} slide layout "${layout ?? ''}" does not match recipe "${expectedLayout}".`,
      })
    }
  }

  if (doc.querySelector('[data-ark-runtime], [data-ark-runtime-lib], [data-ark-preview]')) {
    issues.push({
      code: 'sample_runtime',
      message: 'Theme samples must be CSS-only: no runtime or full-js preview markers.',
    })
  }

  const executableScripts = [...doc.querySelectorAll('script')].filter(
    (script) => !isInertArkThemeScript(script),
  )
  if (executableScripts.length > 0) {
    issues.push({
      code: 'sample_script',
      message: 'Theme samples cannot include scripts.',
    })
  }

  const css = [...doc.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n')
  for (const name of REQUIRED_THEME_CSS_VARS) {
    if (!css.includes(name)) {
      issues.push({
        code: 'sample_token',
        message: `Theme sample CSS is missing ${name}. Use the canonical theme variables.`,
      })
    }
  }

  for (const role of DECK_THEME_COLOR_ROLES) {
    const marker = `${DECK_THEME_COLOR_CSS_VARS[role]}:`
    if (css.includes(marker) && !new RegExp(`${marker}\\s*${theme.colors[role]}`, 'i').test(css)) {
      issues.push({
        code: 'sample_color',
        message: `Theme sample ${role} token does not match the theme spec.`,
      })
    }
  }

  for (const role of DECK_FONT_ROLES) {
    const marked =
      doc.documentElement.getAttribute(DECK_FONT_MARKER_ATTRS[role]) ??
      doc.body?.getAttribute(DECK_FONT_MARKER_ATTRS[role])
    if (marked !== theme.fonts[role]) {
      issues.push({
        code: 'sample_font',
        message: `Theme sample data-ark-font-${role} must be ${theme.fonts[role]}.`,
      })
    }
  }

  return issues
}

export function matchDeckToTheme(doc: Document, expected: DeckThemeSpecV1): DeckThemeIssue[] {
  const issues: DeckThemeIssue[] = []
  const embedded = readDeckThemeFromDocument(doc)
  if (!embedded) {
    issues.push({
      code: 'theme_missing',
      message:
        'Chosen theme metadata is missing. Embed the exact spec in <script type="application/json" data-ark-theme>.',
    })
  } else if (!deckThemesMatch(embedded, expected)) {
    issues.push({
      code: 'theme_mismatch',
      message: 'Embedded theme metadata does not match the selected theme contract.',
    })
  }

  const css = [...doc.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n')
  for (const name of REQUIRED_THEME_CSS_VARS) {
    if (!css.includes(name)) {
      issues.push({
        code: 'theme_token',
        message: `Deck CSS is missing required theme token ${name}.`,
      })
    }
  }

  const slides = findThemeSampleSlides(doc)
  if (slides.length === 0) {
    issues.push({
      code: 'theme_slides',
      message: 'No slides found to classify against the selected theme recipes.',
    })
    return issues
  }

  for (const [index, slide] of slides.entries()) {
    const { kind, layout } = readSlideRecipe(slide)
    if (!kind) {
      issues.push({
        code: 'slide_unclassified',
        message: `Slide ${index} is missing data-ark-slide-kind.`,
      })
      continue
    }
    const expectedLayout = expected.slideRecipes[kind].layout
    if (layout !== expectedLayout) {
      issues.push({
        code: 'slide_layout',
        message: `Slide ${index} (${kind}) layout "${layout ?? ''}" must be "${expectedLayout}".`,
      })
    }
  }

  return issues
}

export function deckThemesMatch(left: DeckThemeSpecV1, right: DeckThemeSpecV1) {
  return (
    deckThemeSignature(left) === deckThemeSignature(right) &&
    left.typography.displayPx === right.typography.displayPx &&
    left.typography.titlePx === right.typography.titlePx &&
    left.typography.bodyPx === right.typography.bodyPx &&
    left.typography.captionPx === right.typography.captionPx &&
    left.spacing.pagePaddingPx === right.spacing.pagePaddingPx &&
    left.spacing.sectionGapPx === right.spacing.sectionGapPx &&
    left.spacing.itemGapPx === right.spacing.itemGapPx &&
    left.spacing.radiusPx === right.spacing.radiusPx
  )
}

export function formatDeckThemeSummary(theme: DeckThemeSpecV1) {
  const colors = DECK_THEME_COLOR_ROLES.map((role) => `${role} ${theme.colors[role]}`).join(', ')
  const recipes = SLIDE_RECIPE_ROLES.map(
    (role) => `${role} ${theme.slideRecipes[role].layout}`,
  ).join('; ')
  return [
    `- Fonts: display ${theme.fonts.display}, body ${theme.fonts.body}, mono ${theme.fonts.mono}`,
    `- Colors: ${colors}`,
    `- Recipes: ${recipes}`,
  ].join('\n')
}

export function buildThemeSampleHtml(
  theme: DeckThemeSpecV1,
  options: {
    title?: string
    extraKind?: (typeof THEME_SAMPLE_OPTIONAL_KINDS)[number]
  } = {},
) {
  const extraKind = options.extraKind ?? 'data'
  const title = options.title ?? 'Title'
  const css = buildDeckThemeRootCss(theme)
  return `<!DOCTYPE html>
<html lang="en" data-ark-font-display="${theme.fonts.display}" data-ark-font-body="${theme.fonts.body}" data-ark-font-mono="${theme.fonts.mono}">
<head><meta charset="UTF-8"/><title>${escapeHtml(title)}</title>
<style>${css}
html,body{margin:0;height:100%;background:var(--ark-color-canvas);color:var(--ark-color-foreground);font-family:var(--ark-font-body)}
.slide{width:100vw;height:100vh;box-sizing:border-box;padding:var(--ark-space-page)}
h1{font-family:var(--ark-font-display);font-size:var(--ark-type-display);margin:0}
h2{font-family:var(--ark-font-display);font-size:var(--ark-type-title);margin:0 0 var(--ark-space-item)}
p{font-size:var(--ark-type-body);color:var(--ark-color-muted)}
</style></head>
<body>
<section class="slide" data-ark-slide-kind="cover" data-ark-layout="${theme.slideRecipes.cover.layout}"><h1>${escapeHtml(title)}</h1></section>
<section class="slide" data-ark-slide-kind="content" data-ark-layout="${theme.slideRecipes.content.layout}"><h2>Content</h2><p>Body copy.</p></section>
<section class="slide" data-ark-slide-kind="${extraKind}" data-ark-layout="${theme.slideRecipes[extraKind].layout}"><h2>${extraKind}</h2><p>Detail.</p></section>
</body></html>`
}

function findThemeSampleSlides(doc: Document) {
  const sections = [...doc.querySelectorAll('section.slide')]
  if (sections.length > 0) return sections
  const stacked = [...doc.querySelectorAll('.slides > section')]
  if (stacked.length > 0) return stacked
  return [...doc.querySelectorAll('body > section')]
}

function contrastRatio(first: string, second: string) {
  const left = relativeLuminance(first)
  const right = relativeLuminance(second)
  const [hi, lo] = left >= right ? [left, right] : [right, left]
  return (hi + 0.05) / (lo + 0.05)
}

function relativeLuminance(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = srgbChannel((value >> 16) & 255)
  const g = srgbChannel((value >> 8) & 255)
  const b = srgbChannel(value & 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function srgbChannel(value: number) {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function fnv1aHex(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export type { DeckFontId }
