import { describe, expect, it } from 'vitest'

import {
  buildDeckThemeRootCss,
  buildThemeSampleHtml,
  createDeckThemeSpec,
  serializeDeckThemeSpec,
} from '@ark/deck/document/theme.ts'

import {
  evaluateDeckThemeMatch,
  evaluateThemeSampleHtml,
  readDeckThemeFromHtml,
} from './theme-html.ts'

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

describe('theme HTML wrappers', () => {
  it('returns null for blank HTML', () => {
    expect(readDeckThemeFromHtml('   ')).toBeNull()
  })

  it('accepts a three-slide sample that follows the spec', () => {
    const theme = darkTheme()
    const html = buildThemeSampleHtml(theme, { extraKind: 'data' })
    expect(evaluateThemeSampleHtml(html, theme)).toEqual([])
    expect(readDeckThemeFromHtml(html)).toBeNull()
  })

  it('reads embedded theme metadata and matches a generated deck', () => {
    const theme = darkTheme()
    const html = `<!DOCTYPE html><html data-ark-font-display="georgia" data-ark-font-body="calibri" data-ark-font-mono="courier-new">
<head><script type="application/json" data-ark-theme>${serializeDeckThemeSpec(theme)}</script>
<style>${buildDeckThemeRootCss(theme)}</style></head>
<body>
<section class="slide" data-ark-slide-kind="cover" data-ark-layout="split-title"><h1>Cover</h1></section>
<section class="slide" data-ark-slide-kind="content" data-ark-layout="two-column"><h2>Body</h2></section>
<section class="slide" data-ark-slide-kind="closing" data-ark-layout="centered-close"><h2>End</h2></section>
</body></html>`

    expect(readDeckThemeFromHtml(html)?.signature).toBe(theme.signature)
    expect(evaluateDeckThemeMatch(html, theme)).toEqual([])
  })
})
