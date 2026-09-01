/**
 * Pre-export lint from deck HTML/CSS.
 *
 * PPTX export still walks the rendered scene for exact flatten regions. This
 * scan is the UI-facing report: it reads the deck source against the font
 * registry and the CSS features that force a picture, without inventing a new
 * endpoint.
 */

import {
  DECK_FONT_CSS_VARS,
  DECK_FONT_ROLES,
  isApprovedDeckFontId,
  isExportSafeFontWeight,
  readDeckFontSelection,
} from '@ark/runtime-registry/deck-font-registry.ts'

export type DeckHtmlExportLintCode =
  'font-weight-unsafe' | 'flatten-to-picture' | 'literal-font-family' | 'unknown-font-id'

export type DeckHtmlExportLintEntry = {
  code: DeckHtmlExportLintCode
  message: string
  count: number
  detail?: string
}

export type DeckHtmlExportLint = {
  entries: DeckHtmlExportLintEntry[]
}

export const EXPORT_LINT_COPY: Record<DeckHtmlExportLintCode, string> = {
  'font-weight-unsafe':
    'Font weights outside 400/700 will collapse to regular or bold in PowerPoint.',
  'flatten-to-picture':
    'Some CSS has no PowerPoint equivalent and will flatten those regions to pictures.',
  'literal-font-family':
    'Literal font-family values bypass --ark-font-* variables, so PowerPoint may pick a different typeface.',
  'unknown-font-id':
    'Unknown font ids are not in the registry and will not survive PowerPoint export.',
}

const NAMED_FONT_WEIGHTS: Record<string, number> = {
  normal: 400,
  bold: 700,
  lighter: 300,
  bolder: 800,
}

const FLATTEN_FEATURES = [
  { code: 'backdrop-filter', pattern: /backdrop-filter\s*:/i },
  { code: 'filter', pattern: /(?<!backdrop-)filter\s*:/i },
  { code: 'mix-blend-mode', pattern: /mix-blend-mode\s*:/i },
  { code: 'clip-path', pattern: /clip-path\s*:/i },
  { code: 'mask', pattern: /(?:^|[\s;{])-webkit-mask(?:-image)?\s*:/i },
  { code: 'mask', pattern: /(?:^|[\s;{])mask(?:-image)?\s*:/i },
  { code: 'conic-gradient', pattern: /conic-gradient\s*\(/i },
] as const

const ARK_FONT_VAR_PATTERN = new RegExp(
  `var\\(\\s*(?:${Object.values(DECK_FONT_CSS_VARS)
    .map((value) => value.replaceAll('-', '\\-'))
    .join('|')})\\s*\\)`,
  'i',
)

function parseDocument(html: string) {
  return new DOMParser().parseFromString(html, 'text/html')
}

function collectStyleSources(doc: Document) {
  const stylesheets = [...doc.querySelectorAll('style')]
    .map((node) => node.textContent ?? '')
    .join('\n')
  const inline: string[] = []
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode() as Element | null
  while (node) {
    const style = node.getAttribute('style')
    if (style?.trim()) inline.push(style)
    node = walker.nextNode() as Element | null
  }
  return { stylesheets, inline, all: `${stylesheets}\n${inline.join('\n')}` }
}

function stripFontFaceRules(css: string) {
  return css.replace(/@font-face\s*\{[^}]*\}/gi, ' ')
}

function parseFontWeightToken(value: string) {
  const token = value
    .trim()
    .replace(/\s*!important\s*$/i, '')
    .trim()
    .split(/\s+/)[0]
  if (!token) return null
  const named = NAMED_FONT_WEIGHTS[token.toLowerCase()]
  if (named !== undefined) return named
  const numeric = Number(token)
  return Number.isFinite(numeric) ? numeric : null
}

function collectUnsafeFontWeights(css: string) {
  const weights = new Set<number>()
  for (const match of css.matchAll(/font-weight\s*:\s*([^;{}]+)/gi)) {
    const weight = parseFontWeightToken(match[1] ?? '')
    if (weight !== null && !isExportSafeFontWeight(weight)) weights.add(weight)
  }
  return [...weights].sort((a, b) => a - b)
}

function collectFlattenFeatures(css: string) {
  const found = new Set<string>()
  for (const feature of FLATTEN_FEATURES) {
    if (feature.pattern.test(css)) found.add(feature.code)
  }
  const generated = css.match(/::(?:before|after)\s*\{[^}]*\}/gi) ?? []
  if (
    generated.some((rule) => {
      const content =
        rule
          .match(/\bcontent\s*:\s*([^;]+)/i)?.[1]
          ?.trim()
          .toLowerCase() ?? ''
      const normalized = content.replace(/\s*!important\s*$/i, '').trim()
      return normalized.length > 0 && normalized !== 'none' && normalized !== 'normal'
    })
  ) {
    found.add('generated content')
  }
  return [...found]
}

function collectLiteralFontFamilies(css: string) {
  const hits: string[] = []
  for (const match of stripFontFaceRules(css).matchAll(/font-family\s*:\s*([^;{}]+)/gi)) {
    const value = match[1]?.trim() ?? ''
    if (!value || ARK_FONT_VAR_PATTERN.test(value)) continue
    hits.push(value.replace(/\s+/g, ' '))
  }
  return hits
}

function collectUnknownFontIds(doc: Document) {
  const selection = readDeckFontSelection(doc)
  return [
    ...new Set(
      DECK_FONT_ROLES.map((role) => selection[role]).filter(
        (id): id is string => Boolean(id) && !isApprovedDeckFontId(id),
      ),
    ),
  ]
}

function entry(
  code: DeckHtmlExportLintCode,
  count: number,
  detail?: string,
): DeckHtmlExportLintEntry {
  return { code, message: EXPORT_LINT_COPY[code], count, detail }
}

export function lintDeckHtmlForExport(html: string): DeckHtmlExportLint {
  if (!html.trim()) return { entries: [] }

  const doc = parseDocument(html)
  const { all } = collectStyleSources(doc)
  const entries: DeckHtmlExportLintEntry[] = []

  const weights = collectUnsafeFontWeights(all)
  if (weights.length > 0) {
    entries.push(entry('font-weight-unsafe', weights.length, weights.join(', ')))
  }

  const flatten = collectFlattenFeatures(all)
  if (flatten.length > 0) {
    entries.push(entry('flatten-to-picture', flatten.length, flatten.join(', ')))
  }

  const literals = collectLiteralFontFamilies(all)
  if (literals.length > 0) {
    entries.push(entry('literal-font-family', literals.length, literals[0]))
  }

  const unknown = collectUnknownFontIds(doc)
  if (unknown.length > 0) {
    entries.push(entry('unknown-font-id', unknown.length, unknown.join(', ')))
  }

  return { entries }
}

export function describeDeckHtmlExportLint(lint: DeckHtmlExportLint): string | undefined {
  if (lint.entries.length === 0) return undefined
  return lint.entries.map((item) => item.message).join(' ')
}

export function formatPptxExportWarning(
  sceneWarning: string | undefined,
  htmlLint: DeckHtmlExportLint,
) {
  const htmlOnly = htmlLint.entries
    .filter((item) => item.code === 'literal-font-family' || item.code === 'unknown-font-id')
    .map((item) => item.message)
  const parts = [sceneWarning, ...htmlOnly].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : undefined
}
