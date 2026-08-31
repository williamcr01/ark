import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'

import type { ThumbnailRenderer } from '@ark/api/thumbnails/renderer.ts'

import { createDeckExportGenerator, DECK_EXPORT_HEIGHT, DECK_EXPORT_WIDTH } from './deck-export.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function readZipEntryNames(archive: Buffer): string[] {
  const endSignature = 0x06054b50
  const centralSignature = 0x02014b50
  const localSignature = 0x04034b50
  const minimumEndOffset = Math.max(0, archive.length - 65_557)
  let endOffset = archive.length - 22

  while (endOffset >= minimumEndOffset && archive.readUInt32LE(endOffset) !== endSignature) {
    endOffset -= 1
  }
  expect(endOffset).toBeGreaterThanOrEqual(minimumEndOffset)

  const entryCount = archive.readUInt16LE(endOffset + 10)
  let offset = archive.readUInt32LE(endOffset + 16)
  const names: string[] = []

  for (let index = 0; index < entryCount; index += 1) {
    expect(archive.readUInt32LE(offset)).toBe(centralSignature)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const localOffset = archive.readUInt32LE(offset + 42)

    expect(archive.readUInt32LE(localOffset)).toBe(localSignature)
    names.push(archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'))
    offset += 46 + nameLength + extraLength + commentLength
  }

  expect(offset).toBe(endOffset)
  return names
}

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

    const entries = readZipEntryNames(output)

    expect(entries).toContain('[Content_Types].xml')
    expect(entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))).toHaveLength(2)
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
