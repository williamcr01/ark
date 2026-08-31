import { describe, expect, it } from 'vitest'

import { parseDeckHtml } from '@ark/deck/document/parser.ts'

import { PPTX_ENCRYPTED_MESSAGE, PPTX_LEGACY_MESSAGE, PptxImportError } from './errors.ts'
import { importPptxToHtml } from './import-pptx.ts'
import { buildEncryptedPptx, buildLegacyPpt, buildPptx } from './pptx-fixtures.ts'

describe('importPptxToHtml', () => {
  it('maps a real PPTX into a new HTML deck with notes, managed elements, and images', async () => {
    const pptx = await buildPptx({
      title: 'Board Update',
      slides: [
        {
          notes: 'Pause on the headline.',
          shapes: [
            { name: 'Title', text: 'Q3 results', x: 457200, y: 365760, cx: 8229600, cy: 1371600 },
            {
              name: 'Accent',
              geom: 'roundRect',
              fill: '4472C4',
              txBox: false,
              x: 457200,
              y: 2286000,
              cx: 2743200,
              cy: 1371600,
            },
          ],
          picture: true,
        },
      ],
    })

    const imported = await importPptxToHtml(pptx, { filename: 'board-update.pptx' })
    const parsed = parseDeckHtml(imported.html)

    expect(imported.title).toBe('Board Update')
    expect(imported.slideCount).toBe(1)
    expect(parsed.slideCount).toBe(1)
    expect(parsed.slides[0]?.notes).toBe('Pause on the headline.')
    expect(imported.html).toContain('data-ark-managed="true"')
    expect(imported.html).toContain('class="ark-text-box"')
    expect(imported.html).toContain('Q3 results')
    expect(imported.html).toContain('data-ark-shape="roundRect"')
    expect(imported.html).toMatch(/src="data:image\/png;base64,/)
    expect(imported.html).not.toMatch(/https?:\/\//)
  })

  it('rejects legacy .ppt files', async () => {
    await expect(importPptxToHtml(buildLegacyPpt(), { filename: 'old.ppt' })).rejects.toMatchObject(
      {
        name: 'PptxImportError',
        code: 'pptx_legacy',
        message: PPTX_LEGACY_MESSAGE,
      } satisfies Partial<PptxImportError>,
    )
  })

  it('rejects password-protected packages', async () => {
    await expect(
      importPptxToHtml(await buildEncryptedPptx(), { filename: 'secret.pptx' }),
    ).rejects.toMatchObject({
      name: 'PptxImportError',
      code: 'pptx_encrypted',
      message: PPTX_ENCRYPTED_MESSAGE,
    } satisfies Partial<PptxImportError>)
  })

  it('rasters a chart when the OOXML cache is missing', async () => {
    const pptx = await buildPptx({
      title: 'Metrics',
      slides: [
        {
          shapes: [{ text: 'Pipeline', x: 457200, y: 182880, cx: 5486400, cy: 914400 }],
          chart: 'uncached',
        },
      ],
    })

    const imported = await importPptxToHtml(pptx, { filename: 'metrics.pptx' })

    expect(imported.html).toContain('alt="Chart"')
    expect(imported.html).toContain('data:image/svg+xml')
    expect(imported.html).not.toContain('data-ark-runtime="chart"')
    expect(imported.warnings.some((warning) => warning.includes('Chart.js'))).toBe(true)
  })

  it('emits Chart.js when series caches are present', async () => {
    const pptx = await buildPptx({
      title: 'Revenue',
      slides: [{ chart: 'cached' }],
    })

    const imported = await importPptxToHtml(pptx, { filename: 'revenue.pptx' })

    expect(imported.html).toContain('data-ark-runtime="chart"')
    expect(imported.html).toContain('/api/runtimes/chart.js/4.5.1/chart.umd.min.js')
    expect(imported.html).toContain('"type":"bar"')
    expect(imported.html).toContain('Q1')
    expect(imported.html).toContain('4.2')
  })

  it('flattens SmartArt onto a background plate and keeps mappable text', async () => {
    const pptx = await buildPptx({
      title: 'Diagram',
      slides: [
        {
          shapes: [{ text: 'Org chart', x: 457200, y: 182880, cx: 5486400, cy: 914400 }],
          smartArt: true,
        },
      ],
    })

    const imported = await importPptxToHtml(pptx, { filename: 'diagram.pptx' })

    expect(imported.html).toContain('Org chart')
    expect(imported.html).toContain('data-ark-managed="true"')
    expect(imported.html).toContain('ark-import-plate')
    expect(imported.warnings.length).toBeGreaterThan(0)
  })

  it('rasters a slide that has no mappable objects', async () => {
    const pptx = await buildPptx({
      title: 'Plate only',
      slides: [{ smartArt: true, notes: 'Walk the diagram.' }],
    })

    const imported = await importPptxToHtml(pptx, { filename: 'plate.pptx' })
    const parsed = parseDeckHtml(imported.html)

    expect(parsed.slides[0]?.notes).toBe('Walk the diagram.')
    expect(imported.html).toContain('ark-import-plate')
    expect(imported.html).not.toContain('data-ark-managed="true"')
  })

  it('maps unknown typefaces onto the registry instead of inventing a CSS stack', async () => {
    const pptx = await buildPptx({
      title: 'Fonts',
      slides: [{ shapes: [{ text: 'Headline', font: 'Comic Sans MS' }] }],
    })

    const imported = await importPptxToHtml(pptx, { filename: 'fonts.pptx' })

    expect(imported.html).toContain('Headline')
    expect(imported.html).not.toContain('Comic Sans')
    expect(imported.html).toContain('data-ark-font-body="calibri"')
    expect(imported.html).toContain('--ark-font-body')
  })
})
