import {
  DECK_FONT_MARKER_ATTRS,
  DECK_FONT_ROLES,
} from '@ark/runtime-registry/deck-font-registry.ts'

import {
  ARK_SLIDE_KIND_ATTR,
  ARK_SLIDE_LAYOUT_ATTR,
  ARK_THEME_ATTR,
  ARK_THEME_SCRIPT_TYPE,
  ARK_THEME_VARS_ATTR,
  DECK_THEME_COLOR_CSS_VARS,
  DECK_THEME_COLOR_ROLES,
  REQUIRED_THEME_CSS_VARS,
  SLIDE_RECIPE_ROLES,
  THEME_SAMPLE_OPTIONAL_KINDS,
  THEME_SAMPLE_REQUIRED_KINDS,
  buildDeckThemeRootCss,
  deckThemeSignature,
  isInertArkThemeScript,
  isSlideRecipeRole,
  parseDeckThemeSpec,
  type DeckThemeSpecV1,
  type SlideRecipeRole,
} from './theme-spec.ts'

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
function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
