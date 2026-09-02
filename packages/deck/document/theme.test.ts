import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  applyDeckThemeToDocument,
  buildDeckThemeRootCss,
  buildThemeSampleHtml,
  createDeckThemeSpec,
  deckThemeContrastIssues,
  deckThemeSignature,
  deckThemeSpecV1Schema,
  hexColorSchema,
  isInertArkThemeScript,
  matchDeckToTheme,
  parseDeckThemeSpec,
  readDeckThemeFromDocument,
  serializeDeckThemeSpec,
} from './theme.ts'
import { evaluateDeckThemeMatch, evaluateThemeSampleHtml } from './theme-html.ts'

const recipes = {
  cover: { layout: 'split-title', rules: ['Display title left, supporting line right.'] },
  section: { layout: 'band-header', rules: ['Full-width label band, then title.'] },
  content: { layout: 'two-column', rules: ['Heading plus two equal body columns.'] },
  data: { layout: 'number-grid', rules: ['Three metric tiles, caption under each.'] },
  closing: { layout: 'centered-close', rules: ['Centered closer, one next-step line.'] },
}

const darkColors = {
  canvas: '#111111',
  surface: '#1c1c1c',
  foreground: '#f4f1ea',
  muted: '#b8b2a8',
  primary: '#c4a574',
  secondary: '#8a7a68',
  accent: '#e8dcc8',
}

function darkTheme() {
  return createDeckThemeSpec({
    fonts: { display: 'georgia', body: 'calibri', mono: 'courier-new' },
    colors: darkColors,
    slideRecipes: recipes,
  })
}

describe('deck theme spec', () => {
  it('normalizes hex, fills a signature, and round-trips metadata', () => {
    const theme = deckThemeSpecV1Schema.parse({
      schemaVersion: 1,
      fonts: { display: 'georgia', body: 'calibri', mono: 'courier-new' },
      colors: { ...darkColors, canvas: '#111111' },
      typography: { displayPx: 64, titlePx: 36, bodyPx: 18, captionPx: 13 },
      spacing: { pagePaddingPx: 56, sectionGapPx: 28, itemGapPx: 12, radiusPx: 8 },
      slideRecipes: recipes,
      signature: 'ignored',
    })

    expect(theme.colors.canvas).toBe('#111111')
    expect(theme.signature).toBe(deckThemeSignature(theme))
    expect(parseDeckThemeSpec(JSON.parse(serializeDeckThemeSpec(theme)))).toEqual(theme)
  })

  it('rejects unknown fonts, short hex, and low-contrast palettes', () => {
    expect(hexColorSchema.safeParse('#fff').success).toBe(false)
    expect(
      deckThemeSpecV1Schema.safeParse({
        schemaVersion: 1,
        fonts: { display: 'inter', body: 'calibri', mono: 'courier-new' },
        colors: darkColors,
        typography: { displayPx: 64, titlePx: 36, bodyPx: 18, captionPx: 13 },
        spacing: { pagePaddingPx: 56, sectionGapPx: 28, itemGapPx: 12, radiusPx: 8 },
        slideRecipes: recipes,
      }).success,
    ).toBe(false)

    const washed = {
      canvas: '#f5f5f5',
      surface: '#ffffff',
      foreground: '#d0d0d0',
      muted: '#e0e0e0',
      primary: '#cccccc',
      secondary: '#dddddd',
      accent: '#eeeeee',
    }
    expect(deckThemeContrastIssues(washed).length).toBeGreaterThan(0)
    expect(
      deckThemeSpecV1Schema.safeParse({
        schemaVersion: 1,
        fonts: { display: 'georgia', body: 'calibri', mono: 'courier-new' },
        colors: washed,
        typography: { displayPx: 64, titlePx: 36, bodyPx: 18, captionPx: 13 },
        spacing: { pagePaddingPx: 56, sectionGapPx: 28, itemGapPx: 12, radiusPx: 8 },
        slideRecipes: recipes,
      }).success,
    ).toBe(false)
  })

  it('emits canonical CSS variables including fonts and colors', () => {
    const css = buildDeckThemeRootCss(darkTheme())
    expect(css).toContain('--ark-font-display:')
    expect(css).toContain('--ark-color-canvas: #111111')
    expect(css).toContain('--ark-type-body: 18px')
    expect(css).toContain('--ark-radius: 8px')
  })

  it('accepts a three-slide sample that follows the spec', () => {
    const theme = darkTheme()
    const html = buildThemeSampleHtml(theme, { extraKind: 'data' })
    expect(evaluateThemeSampleHtml(html, theme)).toEqual([])
  })

  it('rejects samples missing archetypes or using hardcoded mismatching colors', () => {
    const theme = darkTheme()
    const missing = buildThemeSampleHtml(theme).replace('data-ark-slide-kind="cover"', '')
    expect(
      evaluateThemeSampleHtml(missing, theme).some((issue) => issue.code === 'sample_missing_kind'),
    ).toBe(true)

    const mismatched = buildThemeSampleHtml(theme).replaceAll('#111111', '#0000ff')
    expect(
      evaluateThemeSampleHtml(mismatched, theme).some((issue) => issue.code === 'sample_color'),
    ).toBe(true)
  })

  it('round-trips inert theme metadata and ignores it as executable script', () => {
    const theme = darkTheme()
    const html = `<!DOCTYPE html><html><head>
<script type="application/json" data-ark-theme>${serializeDeckThemeSpec(theme)}</script>
<style>${buildDeckThemeRootCss(theme)}</style>
</head><body>
<section class="slide" data-ark-slide-kind="cover" data-ark-layout="split-title"><h1>A</h1></section>
<section class="slide" data-ark-slide-kind="content" data-ark-layout="two-column"><h2>B</h2></section>
</body></html>`
    const doc = new JSDOM(html).window.document
    expect(readDeckThemeFromDocument(doc)?.signature).toBe(theme.signature)
    expect(isInertArkThemeScript(doc.querySelector('script')!)).toBe(true)
  })

  it('matches a generated deck to the selected contract and reports drift', () => {
    const theme = darkTheme()
    const html = `<!DOCTYPE html><html data-ark-font-display="georgia" data-ark-font-body="calibri" data-ark-font-mono="courier-new">
<head><script type="application/json" data-ark-theme>${serializeDeckThemeSpec(theme)}</script>
<style>${buildDeckThemeRootCss(theme)}</style></head>
<body>
<section class="slide" data-ark-slide-kind="cover" data-ark-layout="split-title"><h1>Cover</h1></section>
<section class="slide" data-ark-slide-kind="content" data-ark-layout="two-column"><h2>Body</h2></section>
<section class="slide" data-ark-slide-kind="closing" data-ark-layout="centered-close"><h2>End</h2></section>
</body></html>`

    expect(evaluateDeckThemeMatch(html, theme)).toEqual([])

    const drifted = html.replaceAll('two-column', 'stacked-blocks')
    expect(
      matchDeckToTheme(new JSDOM(drifted).window.document, theme).some(
        (issue) => issue.code === 'slide_layout',
      ),
    ).toBe(true)
  })

  it('applies theme tokens onto a document', () => {
    const theme = darkTheme()
    const doc = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>').window.document
    applyDeckThemeToDocument(doc, theme)
    expect(doc.documentElement.getAttribute('data-ark-font-display')).toBe('georgia')
    expect(doc.querySelector('style[data-ark-theme-vars]')?.textContent).toContain(
      '--ark-color-primary',
    )
  })
})
