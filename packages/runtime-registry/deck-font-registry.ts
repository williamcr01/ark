/**
 * Approved deck fonts.
 *
 * A deck names a font by registry id; the CSS stack and the PowerPoint typeface
 * both come from here, so the two can never drift. OOXML carries a single
 * `<a:latin typeface="..."/>` per run with no fallback list, which is the
 * constraint the whole catalogue is built around: every entry resolves to one
 * family name that Office already has on the recipient's machine.
 *
 * Stacks put the real font first so it wins wherever it is installed, and a
 * metric-compatible clone second. Clones share advance widths with the family
 * they stand in for, so a deck authored on Linux - where the Office fonts are
 * absent - still breaks its lines exactly where PowerPoint will.
 */

export type DeckFontCategory = 'sans' | 'serif' | 'mono'

/** Deck-facing font slots. Each maps to a `data-ark-font-*` marker and a CSS var. */
export type DeckFontRole = 'display' | 'body' | 'mono'

export type DeckFontAvailability =
  /** Ships with Windows and macOS themselves. */
  | 'os'
  /** Ships with Microsoft Office on both platforms. */
  | 'office'

/**
 * Registry ids a deck (or theme proposal) may name. CSS stacks are not valid
 * here — look the id up and use `cssStack` / `pptxTypeface` from the entry.
 */
export const APPROVED_DECK_FONT_IDS = [
  'calibri',
  'arial',
  'cambria',
  'georgia',
  'times-new-roman',
  'courier-new',
] as const

export type DeckFontId = (typeof APPROVED_DECK_FONT_IDS)[number]

export type DeckFont = {
  id: DeckFontId
  label: string
  category: DeckFontCategory
  /** The single family name written to OOXML on export. */
  pptxTypeface: string
  /** Real family first, metric clone second, generic last. */
  cssStack: string
  /** Metric-compatible stand-ins, in stack order. */
  metricClones: string[]
  availability: DeckFontAvailability
}

export const DECK_FONT_ROLES: readonly DeckFontRole[] = ['display', 'body', 'mono']

/**
 * Weights that survive the export. OOXML has a bold flag, not a weight axis, so
 * anything else collapses to one of these when the deck becomes a PPTX.
 */
export const DECK_FONT_SAFE_WEIGHTS: readonly number[] = [400, 700]

export const DECK_FONT_MARKER_ATTRS: Record<DeckFontRole, string> = {
  display: 'data-ark-font-display',
  body: 'data-ark-font-body',
  mono: 'data-ark-font-mono',
}

export const DECK_FONT_CSS_VARS: Record<DeckFontRole, string> = {
  display: '--ark-font-display',
  body: '--ark-font-body',
  mono: '--ark-font-mono',
}

export const APPROVED_DECK_FONTS: readonly DeckFont[] = [
  {
    id: 'calibri',
    label: 'Calibri',
    category: 'sans',
    pptxTypeface: 'Calibri',
    cssStack: '"Calibri", "Carlito", sans-serif',
    metricClones: ['Carlito'],
    availability: 'office',
  },
  {
    id: 'arial',
    label: 'Arial',
    category: 'sans',
    pptxTypeface: 'Arial',
    cssStack: '"Arial", "Liberation Sans", sans-serif',
    metricClones: ['Liberation Sans'],
    availability: 'os',
  },
  {
    id: 'cambria',
    label: 'Cambria',
    category: 'serif',
    pptxTypeface: 'Cambria',
    cssStack: '"Cambria", "Caladea", serif',
    metricClones: ['Caladea'],
    availability: 'office',
  },
  {
    id: 'georgia',
    label: 'Georgia',
    category: 'serif',
    pptxTypeface: 'Georgia',
    cssStack: '"Georgia", "Gelasio", serif',
    metricClones: ['Gelasio'],
    availability: 'os',
  },
  {
    id: 'times-new-roman',
    label: 'Times New Roman',
    category: 'serif',
    pptxTypeface: 'Times New Roman',
    cssStack: '"Times New Roman", "Liberation Serif", serif',
    metricClones: ['Liberation Serif'],
    availability: 'os',
  },
  {
    id: 'courier-new',
    label: 'Courier New',
    category: 'mono',
    pptxTypeface: 'Courier New',
    cssStack: '"Courier New", "Liberation Mono", monospace',
    metricClones: ['Liberation Mono'],
    availability: 'os',
  },
]

export const DEFAULT_DECK_FONT_IDS: Record<DeckFontRole, DeckFontId> = {
  display: 'calibri',
  body: 'calibri',
  mono: 'courier-new',
}

/** Per-role font ids read off a deck, or null where the deck declared none. */
export type DeckFontSelection = Record<DeckFontRole, string | null>

/** Reads `data-ark-font-*` markers off `<html>` or `<body>`. */
export function readDeckFontSelection(doc: Document): DeckFontSelection {
  const html = doc.documentElement
  const body = doc.body

  return Object.fromEntries(
    DECK_FONT_ROLES.map((role) => {
      const attribute = DECK_FONT_MARKER_ATTRS[role]
      const value = html?.getAttribute(attribute) ?? body?.getAttribute(attribute) ?? null
      return [role, value?.trim().toLowerCase() || null]
    }),
  ) as DeckFontSelection
}

const FONTS_BY_ID = new Map<string, DeckFont>(APPROVED_DECK_FONTS.map((font) => [font.id, font]))

export function getApprovedDeckFonts() {
  return APPROVED_DECK_FONTS
}

export function getDeckFont(id: string | null | undefined) {
  if (!id) return null
  return FONTS_BY_ID.get(id.trim().toLowerCase()) ?? null
}

/**
 * Resolve an OOXML `typeface` to a registry font. Unknown names fall through so
 * callers can substitute a role default rather than inventing a CSS stack the
 * exporter cannot name.
 */
export function getDeckFontByPptxTypeface(typeface: string | null | undefined) {
  if (!typeface) return null
  const key = typeface.trim().toLowerCase()
  if (!key || key.startsWith('+')) return null
  return (
    APPROVED_DECK_FONTS.find(
      (font) =>
        font.pptxTypeface.toLowerCase() === key ||
        font.metricClones.some((clone) => clone.toLowerCase() === key),
    ) ?? null
  )
}

export function isApprovedDeckFontId(id: string | null | undefined) {
  return getDeckFont(id) !== null
}

export function getDeckFontsByCategory(category: DeckFontCategory) {
  return APPROVED_DECK_FONTS.filter((font) => font.category === category)
}

export function isExportSafeFontWeight(weight: number) {
  return DECK_FONT_SAFE_WEIGHTS.includes(weight)
}

/** Resolve a role to its font, falling back to the role default. */
export function resolveDeckFont(selection: DeckFontSelection, role: DeckFontRole) {
  return getDeckFont(selection[role]) ?? getDeckFont(DEFAULT_DECK_FONT_IDS[role])!
}

/**
 * The `:root` block a deck declares. Generated rather than hand-written so a
 * deck's stacks always match what the exporter will look up.
 */
export function buildDeckFontRootCss(selection: Partial<DeckFontSelection> = {}) {
  const declarations = DECK_FONT_ROLES.map((role) => {
    const font = getDeckFont(selection[role]) ?? getDeckFont(DEFAULT_DECK_FONT_IDS[role])!
    return `  ${DECK_FONT_CSS_VARS[role]}: ${font.cssStack};`
  })

  return `:root {\n${declarations.join('\n')}\n}`
}

const GENERIC_FAMILY_FALLBACKS: Record<string, string> = {
  'sans-serif': 'Calibri',
  'ui-sans-serif': 'Calibri',
  'system-ui': 'Calibri',
  serif: 'Cambria',
  'ui-serif': 'Cambria',
  monospace: 'Courier New',
  'ui-monospace': 'Courier New',
}

/**
 * Families a deck may name that Office cannot resolve, mapped to the closest
 * typeface it can. Covers the platform-specific stacks that generated CSS
 * reaches for by habit - San Francisco, Segoe UI, Roboto - none of which exist
 * everywhere PowerPoint runs.
 */
const TYPEFACE_SUBSTITUTIONS: Record<string, string> = {
  '-apple-system': 'Calibri',
  blinkmacsystemfont: 'Calibri',
  'segoe ui': 'Calibri',
  'segoe ui variable': 'Calibri',
  roboto: 'Calibri',
  inter: 'Calibri',
  'open sans': 'Calibri',
  lato: 'Calibri',
  'source sans pro': 'Calibri',
  'noto sans': 'Calibri',
  'pt sans': 'Calibri',
  helvetica: 'Arial',
  'helvetica neue': 'Arial',
  aptos: 'Calibri',
  tahoma: 'Arial',
  verdana: 'Arial',
  'trebuchet ms': 'Arial',
  garamond: 'Cambria',
  'palatino linotype': 'Cambria',
  'book antiqua': 'Cambria',
  'noto serif': 'Cambria',
  'source serif pro': 'Cambria',
  merriweather: 'Georgia',
  times: 'Times New Roman',
  consolas: 'Courier New',
  menlo: 'Courier New',
  monaco: 'Courier New',
  'sf mono': 'Courier New',
  'jetbrains mono': 'Courier New',
  'fira code': 'Courier New',
  'ibm plex mono': 'Courier New',
  courier: 'Courier New',
}

function splitFontFamilyStack(stack: string) {
  return stack
    .split(',')
    .map((part) =>
      part
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim(),
    )
    .filter(Boolean)
}

/**
 * Best-effort typeface for a deck that carries no font markers - an upload, or
 * anything authored before the registry.
 *
 * A CSS stack is a fallback chain and OOXML has no equivalent, so this walks the
 * chain the author wrote and returns the first family Office can resolve. That
 * keeps the author's own ordering while guaranteeing the recipient gets a font
 * they have, instead of whatever PowerPoint would substitute unprompted. Only
 * when nothing in the chain is resolvable does the first family pass through.
 */
export function resolvePptxTypeface(fontFamily: string | null | undefined): string {
  const families = splitFontFamilyStack(fontFamily ?? '')

  for (const family of families) {
    const key = family.toLowerCase()

    const approved = APPROVED_DECK_FONTS.find(
      (font) =>
        font.pptxTypeface.toLowerCase() === key ||
        font.metricClones.some((clone) => clone.toLowerCase() === key),
    )
    if (approved) return approved.pptxTypeface

    const substitution = TYPEFACE_SUBSTITUTIONS[key]
    if (substitution) return substitution

    const generic = GENERIC_FAMILY_FALLBACKS[key]
    if (generic) return generic
  }

  // Nothing recognised: hand PowerPoint the deck's own first choice and let it
  // substitute, rather than silently overriding the author.
  return families[0] ?? GENERIC_FAMILY_FALLBACKS['sans-serif']
}

export function buildDeckFontPromptSection() {
  const lines = ['Approved deck fonts (set the marker on <html>, then use only the CSS variables):']

  for (const font of APPROVED_DECK_FONTS) {
    const clone = font.metricClones[0]
    const source = font.availability === 'office' ? 'Microsoft Office' : 'Windows and macOS'
    lines.push(
      `- ${font.id} (${font.category}): ${font.cssStack} - ships with ${source}${clone ? `, metric-compatible clone ${clone}` : ''}.`,
    )
  }

  lines.push(
    `Markers: ${DECK_FONT_ROLES.map((role) => `${DECK_FONT_MARKER_ATTRS[role]}="<id>"`).join(', ')}.`,
    `Variables: ${DECK_FONT_ROLES.map((role) => `var(${DECK_FONT_CSS_VARS[role]})`).join(', ')}.`,
    `Weights ${DECK_FONT_SAFE_WEIGHTS.join(' and ')} survive PowerPoint export; other weights collapse to the nearer of the two.`,
  )

  return lines.join('\n')
}
