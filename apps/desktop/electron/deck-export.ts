import { PDFDocument } from 'pdf-lib'
import PptxGenJS from 'pptxgenjs'

import type { ThumbnailRenderer } from '@ark/api/thumbnails/renderer.ts'

export const DECK_EXPORT_WIDTH = 1280
export const DECK_EXPORT_HEIGHT = 720
export const DECK_EXPORT_MAX_PNG_BYTES = 10_000_000

export type DeckExportFormat = 'pdf' | 'pptx'

export type DeckExportRequest = {
  format: DeckExportFormat
  html: string
  title: string
}

async function generatePdf(slides: Buffer[], title: string) {
  const document = await PDFDocument.create()
  document.setCreator('Ark')
  document.setProducer('Ark')
  document.setTitle(title)

  for (const slide of slides) {
    const image = await document.embedPng(slide.toString('base64'))
    const page = document.addPage([DECK_EXPORT_WIDTH, DECK_EXPORT_HEIGHT])
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: DECK_EXPORT_WIDTH,
      height: DECK_EXPORT_HEIGHT,
    })
  }

  return Buffer.from(await document.save())
}

async function generatePptx(slides: Buffer[], title: string) {
  const presentation = new PptxGenJS()
  presentation.layout = 'LAYOUT_WIDE'
  presentation.author = 'Ark'
  presentation.company = 'Ark'
  presentation.subject = title
  presentation.title = title

  for (const image of slides) {
    const slide = presentation.addSlide()
    slide.background = { color: 'FFFFFF' }
    slide.addImage({
      data: `data:image/png;base64,${image.toString('base64')}`,
      x: 0,
      y: 0,
      w: 13.333,
      h: 7.5,
    })
  }

  const output = await presentation.write({ outputType: 'nodebuffer' })
  if (!ArrayBuffer.isView(output)) {
    throw new Error('PowerPoint generator returned an unexpected output type.')
  }
  return Buffer.from(output.buffer, output.byteOffset, output.byteLength)
}

export function createDeckExportGenerator(slideRenderer: ThumbnailRenderer) {
  return async ({ format, html, title }: DeckExportRequest): Promise<Buffer> => {
    const rendered = await slideRenderer.render({ html })
    if (!rendered.ok) throw new Error(rendered.error)
    if (rendered.width !== DECK_EXPORT_WIDTH || rendered.height !== DECK_EXPORT_HEIGHT) {
      throw new Error('Deck exporter received captures with unexpected dimensions.')
    }

    return format === 'pdf'
      ? generatePdf(rendered.slides, title)
      : generatePptx(rendered.slides, title)
  }
}
