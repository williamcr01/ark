// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { EXPORT_LINT_COPY, formatPptxExportWarning, lintDeckHtmlForExport } from './export-lint'

function deckHtml(partial: { htmlAttrs?: string; css?: string; body?: string }) {
  return `<!DOCTYPE html>
<html lang="en" ${partial.htmlAttrs ?? 'data-ark-font-display="georgia" data-ark-font-body="calibri" data-ark-font-mono="courier-new"'}>
<head>
<meta charset="UTF-8" />
<style>
:root {
  --ark-font-display: "Georgia", "Gelasio", serif;
  --ark-font-body: "Calibri", "Carlito", sans-serif;
  --ark-font-mono: "Courier New", "Liberation Mono", monospace;
}
.slide { font-family: var(--ark-font-body); font-weight: 400; }
h1 { font-family: var(--ark-font-display); font-weight: 700; }
${partial.css ?? ''}
</style>
</head>
<body>
<section class="slide"><h1>Title</h1><p>Body</p>${partial.body ?? ''}</section>
</body>
</html>`
}

describe('lintDeckHtmlForExport', () => {
  it('is silent for a deck that uses registry vars and safe weights', () => {
    expect(lintDeckHtmlForExport(deckHtml({})).entries).toEqual([])
  })

  it('reports font weights outside 400/700', () => {
    const lint = lintDeckHtmlForExport(
      deckHtml({
        css: 'h2 { font-weight: 600; } .lede { font-weight: 300; }',
      }),
    )

    expect(lint.entries).toEqual([
      {
        code: 'font-weight-unsafe',
        message: EXPORT_LINT_COPY['font-weight-unsafe'],
        count: 2,
        detail: '300, 600',
      },
    ])
  })

  it('reports flatten-to-picture CSS including generated content', () => {
    const lint = lintDeckHtmlForExport(
      deckHtml({
        css: `
.hero { backdrop-filter: blur(8px); mix-blend-mode: multiply; }
.card { filter: blur(4px); clip-path: circle(50%); }
.badge::before { content: "★"; }
.panel { background: conic-gradient(red, blue); }
`,
      }),
    )

    const flatten = lint.entries.find((entry) => entry.code === 'flatten-to-picture')
    expect(flatten).toMatchObject({
      code: 'flatten-to-picture',
      message: EXPORT_LINT_COPY['flatten-to-picture'],
    })
    expect(flatten?.detail).toContain('backdrop-filter')
    expect(flatten?.detail).toContain('filter')
    expect(flatten?.detail).toContain('mix-blend-mode')
    expect(flatten?.detail).toContain('clip-path')
    expect(flatten?.detail).toContain('conic-gradient')
    expect(flatten?.detail).toContain('generated content')
  })

  it('reports literal font-family that bypasses --ark-font-* variables', () => {
    const lint = lintDeckHtmlForExport(
      deckHtml({
        css: 'p { font-family: "Comic Sans MS", sans-serif; }',
      }),
    )

    expect(lint.entries).toEqual([
      {
        code: 'literal-font-family',
        message: EXPORT_LINT_COPY['literal-font-family'],
        count: 1,
        detail: '"Comic Sans MS", sans-serif',
      },
    ])
  })

  it('does not treat @font-face or var(--ark-font-*) as a literal bypass', () => {
    const lint = lintDeckHtmlForExport(
      deckHtml({
        css: `@font-face { font-family: Carlito; src: local("Carlito"); }`,
      }),
    )

    expect(lint.entries).toEqual([])
  })

  it('reports unknown font ids from data-ark-font-* markers', () => {
    const lint = lintDeckHtmlForExport(
      deckHtml({
        htmlAttrs:
          'data-ark-font-display="inter" data-ark-font-body="calibri" data-ark-font-mono="ibm-plex"',
      }),
    )

    expect(lint.entries).toEqual([
      {
        code: 'unknown-font-id',
        message: EXPORT_LINT_COPY['unknown-font-id'],
        count: 2,
        detail: 'inter, ibm-plex',
      },
    ])
  })

  it('appends HTML-only findings onto the scene export warning', () => {
    const lint = lintDeckHtmlForExport(
      deckHtml({
        htmlAttrs: 'data-ark-font-display="inter"',
        css: 'p { font-family: Helvetica; font-weight: 600; }',
      }),
    )

    expect(
      formatPptxExportWarning('some font weights collapsed to regular or bold', lint),
    ).toContain(EXPORT_LINT_COPY['literal-font-family'])
    expect(
      formatPptxExportWarning('some font weights collapsed to regular or bold', lint),
    ).toContain(EXPORT_LINT_COPY['unknown-font-id'])
    expect(
      formatPptxExportWarning('some font weights collapsed to regular or bold', lint),
    ).toContain('some font weights collapsed to regular or bold')
  })
})
