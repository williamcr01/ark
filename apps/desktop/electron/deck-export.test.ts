import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'

import type { ThumbnailRenderer } from '@ark/api/thumbnails/renderer.ts'

import { createDeckExportGenerator, DECK_EXPORT_HEIGHT, DECK_EXPORT_WIDTH } from './deck-export.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function rendererWith(slides: Buffer[]): ThumbnailRenderer {
  return {
    isAvailable: () => true,
    close: async () => undefined,
    render: vi.fn(async () => ({
      ok: true as const,
      slides,
      slideCount: slides.length,
      width: DECK_EXPORT_WIDTH,
      height: DECK_EXPORT_HEIGHT,
      durationMs: 1,
    })),
  }
}

describe('deck export generator', () => {
  it('creates one 1280x720 PDF page per rendered slide', async () => {
    const generate = createDeckExportGenerator(rendererWith([png, png]))

    const output = await generate({ format: 'pdf', html: '<html></html>', title: 'Quarterly' })
    const document = await PDFDocument.load(output.toString('base64'))

    expect(document.getPageCount()).toBe(2)
    expect(document.getPage(0).getSize()).toEqual({
      width: DECK_EXPORT_WIDTH,
      height: DECK_EXPORT_HEIGHT,
    })
  })

  it('creates a PowerPoint containing one slide per rendered image', async () => {
    const generate = createDeckExportGenerator(rendererWith([png, png]))
    const output = await generate({ format: 'pptx', html: '<html></html>', title: 'Quarterly' })

    expect(output.subarray(0, 2).toString('ascii')).toBe('PK')
    expect(output.byteLength).toBeGreaterThan(png.byteLength * 2)
  })

  it('rejects captures that are not export-sized', async () => {
    const renderer = rendererWith([png])
    vi.mocked(renderer.render).mockResolvedValueOnce({
      ok: true,
      slides: [png],
      slideCount: 1,
      width: 480,
      height: 270,
      durationMs: 1,
    })

    const generate = createDeckExportGenerator(renderer)
    await expect(
      generate({ format: 'pdf', html: '<html></html>', title: 'Quarterly' }),
    ).rejects.toThrow('unexpected dimensions')
  })
})
