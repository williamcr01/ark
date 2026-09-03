import { JSDOM } from 'jsdom'

import {
  inspectThemeSample,
  matchDeckToTheme,
  readDeckThemeFromDocument,
  type DeckThemeIssue,
  type DeckThemeSpecV1,
} from '@ark/deck/document/theme.ts'

export function evaluateThemeSampleHtml(html: string, theme: DeckThemeSpecV1): DeckThemeIssue[] {
  const doc = new JSDOM(html).window.document
  return inspectThemeSample(doc, theme)
}

export function evaluateDeckThemeMatch(html: string, expected: DeckThemeSpecV1): DeckThemeIssue[] {
  const doc = new JSDOM(html).window.document
  return matchDeckToTheme(doc, expected)
}

export function readDeckThemeFromHtml(html: string): DeckThemeSpecV1 | null {
  if (!html.trim()) return null
  return readDeckThemeFromDocument(new JSDOM(html).window.document)
}
