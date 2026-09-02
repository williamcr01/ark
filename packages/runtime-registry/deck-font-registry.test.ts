import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  APPROVED_DECK_FONTS,
  buildDeckFontPromptSection,
  buildDeckFontRootCss,
  buildMetricCloneFontAssetUrl,
  buildMetricCloneFontFaceCss,
  DECK_FONT_CSS_VARS,
  DECK_FONT_MARKER_ATTRS,
  DECK_FONT_ROLES,
  DECK_FONT_SAFE_WEIGHTS,
  DECK_FONTS_RUNTIME_ID,
  DECK_FONTS_RUNTIME_VERSION,
  DEFAULT_DECK_FONT_IDS,
  getDeckFont,
  getDeckFontByPptxTypeface,
  getDeckFontsByCategory,
  isApprovedDeckFontId,
  isExportSafeFontWeight,
  METRIC_CLONE_FONT_FACES,
  readDeckFontSelection,
  resolveDeckFont,
  resolvePptxTypeface,
} from './deck-font-registry.ts'
import { getApprovedRuntime } from './deck-runtime-registry.ts'

describe('approved deck fonts', () => {
  it('gives every font a unique id', () => {
    const ids = APPROVED_DECK_FONTS.map((font) => font.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('names a single OOXML typeface per font, with no fallback list', () => {
    for (const font of APPROVED_DECK_FONTS) {
      expect(font.pptxTypeface).not.toContain(',')
      expect(font.pptxTypeface.trim()).toBe(font.pptxTypeface)
    }
  })

  it('puts the real family first and its metric clone next in every stack', () => {
    for (const font of APPROVED_DECK_FONTS) {
      const families = font.cssStack.split(',').map((part) => part.trim().replace(/"/g, ''))

      expect(families[0]).toBe(font.pptxTypeface)
      expect(families.slice(1, 1 + font.metricClones.length)).toEqual(font.metricClones)
      expect(families.at(-1)).toMatch(/^(sans-serif|serif|monospace)$/)
    }
  })

  it('covers every role default and every category', () => {
    for (const role of DECK_FONT_ROLES) {
      expect(isApprovedDeckFontId(DEFAULT_DECK_FONT_IDS[role])).toBe(true)
    }
    expect(getDeckFontsByCategory('sans').length).toBeGreaterThan(0)
    expect(getDeckFontsByCategory('serif').length).toBeGreaterThan(0)
    expect(getDeckFontsByCategory('mono').length).toBeGreaterThan(0)
  })

  it('looks fonts up case-insensitively and rejects unknown ids', () => {
    expect(getDeckFont('CALIBRI')?.pptxTypeface).toBe('Calibri')
    expect(getDeckFont(' calibri ')?.pptxTypeface).toBe('Calibri')
    expect(getDeckFont('helvetica')).toBeNull()
    expect(isApprovedDeckFontId(null)).toBe(false)
    expect(getDeckFontByPptxTypeface('Calibri')?.id).toBe('calibri')
    expect(getDeckFontByPptxTypeface('Liberation Sans')?.id).toBe('arial')
    expect(getDeckFontByPptxTypeface('Comic Sans MS')).toBeNull()
  })
})

describe('resolveDeckFont', () => {
  it('falls back to the role default when a deck declared nothing', () => {
    const selection = { display: null, body: null, mono: null }

    expect(resolveDeckFont(selection, 'body').id).toBe(DEFAULT_DECK_FONT_IDS.body)
    expect(resolveDeckFont(selection, 'mono').id).toBe(DEFAULT_DECK_FONT_IDS.mono)
  })

  it('falls back when a deck declared a font the registry does not know', () => {
    expect(resolveDeckFont({ display: 'comic-sans', body: null, mono: null }, 'display').id).toBe(
      DEFAULT_DECK_FONT_IDS.display,
    )
  })

  it('uses the declared font when it is approved', () => {
    expect(resolveDeckFont({ display: 'cambria', body: null, mono: null }, 'display').id).toBe(
      'cambria',
    )
  })
})

describe('buildDeckFontRootCss', () => {
  it('declares every role variable from the registry stacks', () => {
    const css = buildDeckFontRootCss({ display: 'cambria', body: 'calibri', mono: 'courier-new' })

    expect(css).toContain(`${DECK_FONT_CSS_VARS.display}: ${getDeckFont('cambria')!.cssStack}`)
    expect(css).toContain(`${DECK_FONT_CSS_VARS.body}: ${getDeckFont('calibri')!.cssStack}`)
    expect(css).toContain(`${DECK_FONT_CSS_VARS.mono}: ${getDeckFont('courier-new')!.cssStack}`)
  })

  it('fills unspecified roles with the defaults', () => {
    expect(buildDeckFontRootCss()).toBe(buildDeckFontRootCss(DEFAULT_DECK_FONT_IDS))
  })

  it('declares only :root variables, not vendored @font-face rules', () => {
    const css = buildDeckFontRootCss()

    expect(css.startsWith(':root {')).toBe(true)
    expect(css).not.toContain('@font-face')
  })
})

describe('buildMetricCloneFontFaceCss', () => {
  it('emits @font-face rules that load vendored clones, not Office typeface names', () => {
    const css = buildMetricCloneFontFaceCss()

    for (const face of METRIC_CLONE_FONT_FACES) {
      const url = buildMetricCloneFontAssetUrl(face.path)

      expect(css).toContain(`font-family: ${JSON.stringify(face.family)}`)
      expect(css).toContain(`url("${url}") format("${face.format}")`)
    }

    for (const font of APPROVED_DECK_FONTS) {
      expect(css).not.toContain(`font-family: ${JSON.stringify(font.pptxTypeface)}`)
    }
  })
})

describe('resolvePptxTypeface', () => {
  it.each([
    ['"Calibri", "Carlito", sans-serif', 'Calibri'],
    ['Carlito, sans-serif', 'Calibri'],
    ['"Liberation Serif", serif', 'Times New Roman'],
    ['-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', 'Calibri'],
    ['"Helvetica Neue", Helvetica, Arial, sans-serif', 'Arial'],
    ['Consolas, Menlo, monospace', 'Courier New'],
    ['Georgia, serif', 'Georgia'],
    ['serif', 'Cambria'],
    ['monospace', 'Courier New'],
    ['', 'Calibri'],
  ])('maps %j to %j', (stack, expected) => {
    expect(resolvePptxTypeface(stack)).toBe(expected)
  })

  it("walks the deck's own fallback chain to the first family Office can resolve", () => {
    expect(resolvePptxTypeface('"Brand Grotesk", Georgia, serif')).toBe('Georgia')
    expect(resolvePptxTypeface('Georgia, "Brand Grotesk"')).toBe('Georgia')
    // A generic tail is still a resolvable choice the author asked for.
    expect(resolvePptxTypeface('"Brand Grotesk", sans-serif')).toBe('Calibri')
  })

  it('passes the family through when nothing in the chain is resolvable', () => {
    expect(resolvePptxTypeface('"Brand Grotesk"')).toBe('Brand Grotesk')
  })

  it('still names the Office typeface when the stack starts with a vendored clone', () => {
    expect(resolvePptxTypeface('"Carlito", sans-serif')).toBe('Calibri')
    expect(resolvePptxTypeface('"Caladea", serif')).toBe('Cambria')
    expect(resolvePptxTypeface('"Gelasio", serif')).toBe('Georgia')
    expect(resolvePptxTypeface('"Liberation Sans", sans-serif')).toBe('Arial')
    expect(resolvePptxTypeface('"Liberation Serif", serif')).toBe('Times New Roman')
    expect(resolvePptxTypeface('"Liberation Mono", monospace')).toBe('Courier New')
  })
})

describe('export-safe weights', () => {
  it('accepts only the weights the OOXML bold flag can carry', () => {
    expect(DECK_FONT_SAFE_WEIGHTS).toEqual([400, 700])
    expect(isExportSafeFontWeight(400)).toBe(true)
    expect(isExportSafeFontWeight(700)).toBe(true)
    expect(isExportSafeFontWeight(600)).toBe(false)
  })
})

describe('readDeckFontSelection', () => {
  it('reads font markers off html, falling back to body', () => {
    const doc = {
      documentElement: {
        getAttribute: (name: string) => (name === 'data-ark-font-display' ? ' Cambria ' : null),
      },
      body: {
        getAttribute: (name: string) => (name === 'data-ark-font-body' ? 'CALIBRI' : null),
      },
    } as unknown as Document

    expect(readDeckFontSelection(doc)).toEqual({
      display: 'cambria',
      body: 'calibri',
      mono: null,
    })
  })
})

describe('buildDeckFontPromptSection', () => {
  it('lists every font with its marker and variable vocabulary', () => {
    const prompt = buildDeckFontPromptSection()

    for (const font of APPROVED_DECK_FONTS) {
      expect(prompt).toContain(font.id)
      expect(prompt).toContain(font.cssStack)
    }
    for (const role of DECK_FONT_ROLES) {
      expect(prompt).toContain(DECK_FONT_MARKER_ATTRS[role])
      expect(prompt).toContain(DECK_FONT_CSS_VARS[role])
    }
  })
})

describe('vendored metric clone faces', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

  it('covers every clone named in the registry with 400/700 regular and italic', () => {
    const families = new Set(METRIC_CLONE_FONT_FACES.map((face) => face.family))

    for (const font of APPROVED_DECK_FONTS) {
      expect(font.metricClones.every((clone) => families.has(clone))).toBe(true)
    }

    for (const family of families) {
      const faces = METRIC_CLONE_FONT_FACES.filter((face) => face.family === family)
      expect(faces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ weight: 400, style: 'normal' }),
          expect.objectContaining({ weight: 400, style: 'italic' }),
          expect.objectContaining({ weight: 700, style: 'normal' }),
          expect.objectContaining({ weight: 700, style: 'italic' }),
        ]),
      )
    }
  })

  it('matches the approved deck-fonts runtime assets on disk', () => {
    const runtime = getApprovedRuntime(DECK_FONTS_RUNTIME_ID, DECK_FONTS_RUNTIME_VERSION)

    expect(runtime).not.toBeNull()
    expect(runtime?.runtimeMode).toBe('static')
    expect(runtime?.license).toBe('OFL-1.1')

    const assetPaths = new Set(runtime?.assets.map((asset) => asset.path))
    const facePaths = new Set(METRIC_CLONE_FONT_FACES.map((face) => face.path))

    expect(assetPaths).toEqual(facePaths)

    for (const face of METRIC_CLONE_FONT_FACES) {
      const asset = runtime?.assets.find((entry) => entry.path === face.path)

      expect(asset?.kind).toBe('font')
      expect(asset?.license).toBe('OFL-1.1')
      expect(
        existsSync(
          path.join(ROOT, 'runtimes', DECK_FONTS_RUNTIME_ID, DECK_FONTS_RUNTIME_VERSION, face.path),
        ),
      ).toBe(true)
    }
  })

  it('records the clones in NOTICE and keeps only the six metric-clone families on disk', () => {
    const notice = readFileSync(path.join(ROOT, 'NOTICE'), 'utf8')
    const familyDirs = readdirSync(
      path.join(ROOT, 'runtimes', DECK_FONTS_RUNTIME_ID, DECK_FONTS_RUNTIME_VERSION),
      { withFileTypes: true },
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    expect(familyDirs).toEqual([
      'caladea',
      'carlito',
      'gelasio',
      'liberation-mono',
      'liberation-sans',
      'liberation-serif',
    ])

    expect(notice).toContain('Carlito')
    expect(notice).toContain('Caladea')
    expect(notice).toContain('Gelasio')
    expect(notice).toContain('Liberation Sans')
    expect(notice).toContain('Liberation Serif')
    expect(notice).toContain('Liberation Mono')
    expect(notice).toContain('runtimes/deck-fonts/')
    expect(notice).toMatch(/OFL-1\.1/)
  })

  it('does not vendor Tier 2 OFL display faces', () => {
    const notice = readFileSync(path.join(ROOT, 'NOTICE'), 'utf8')
    const families = [...new Set(METRIC_CLONE_FONT_FACES.map((face) => face.family))]

    expect(APPROVED_DECK_FONTS.map((font) => font.id)).toEqual([
      'calibri',
      'arial',
      'cambria',
      'georgia',
      'times-new-roman',
      'courier-new',
    ])
    expect(families).toEqual([
      'Carlito',
      'Caladea',
      'Gelasio',
      'Liberation Sans',
      'Liberation Serif',
      'Liberation Mono',
    ])
    expect(isApprovedDeckFontId('inter')).toBe(false)
    expect(notice).not.toContain('IBM Plex')
    expect(notice).not.toContain('Literata')
    expect(notice).not.toContain('JetBrains Mono')
    expect(notice).not.toContain('Source Sans 3')
  })
})
