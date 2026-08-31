/**
 * Deck export: one PDF page per slide, printed as vector.
 *
 * Each slide is rendered in the shared hidden window and printed with Electron's
 * `printToPDF`, so the output carries real text, embedded fonts, and live links
 * rather than a screenshot. The page box is the deck's own reference frame -
 * 1280x720 CSS px is exactly 13.333in x 7.5in at 96dpi, which is also
 * PowerPoint's widescreen slide - so slides land on the page 1:1 with no
 * scaling.
 */

import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'

import {
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from '@ark/deck/document/metadata.ts'

import { withDeckRenderWindow, type DeckRenderWindowConfig } from './deck-render-window.ts'

/** CSS reference pixels per inch. Fixed by the CSS spec, not by the display. */
const CSS_PIXELS_PER_INCH = 96

export const DECK_EXPORT_PAGE_WIDTH_INCHES = ARK_SLIDE_REFERENCE_WIDTH / CSS_PIXELS_PER_INCH
export const DECK_EXPORT_PAGE_HEIGHT_INCHES = ARK_SLIDE_REFERENCE_HEIGHT / CSS_PIXELS_PER_INCH

/** Well past any realistic deck; a guard against runaway input, not a product limit. */
export const DECK_EXPORT_MAX_SLIDES = 300
/** Printing is slower per slide than capturing, and decks here can be long. */
export const DECK_EXPORT_TIMEOUT_MS = 10 * 60_000

const DECK_EXPORT_LABEL = 'Deck exporter'

/**
 * Chromium's print pass re-lays out the document. Pin the page box to the slide
 * frame so a stray overflow cannot spill onto a second page, and force colour
 * fidelity - `printBackground` alone does not cover backgrounds suppressed by
 * `print-color-adjust`.
 */
const DECK_EXPORT_PRINT_CSS = `
@media print {
  html, body {
    width: ${ARK_SLIDE_REFERENCE_WIDTH}px !important;
    height: ${ARK_SLIDE_REFERENCE_HEIGHT}px !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
  }
  *, *::before, *::after {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
`

export type DeckExportFormat = 'pdf'

export type DeckExportRequest = {
  format: DeckExportFormat
  html: string
  title: string
}

/**
 * Concatenate one-page-per-slide PDFs into the delivered document.
 *
 * Only the first page of each slide print is kept: a deck whose content
 * overflows the slide frame would otherwise contribute a stray extra page, and
 * the deck's own bounds are what the user previewed.
 */
async function mergeSlidePdfs(slidePdfs: Uint8Array[], title: string) {
  const merged = await PDFDocument.create()
  merged.setCreator('Ark')
  merged.setProducer('Ark')
  merged.setTitle(title || 'Untitled Presentation')

  for (const slidePdf of slidePdfs) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- sequential by design: pages must be appended in slide order
    const slide = await PDFDocument.load(slidePdf)
    if (slide.getPageCount() === 0) continue
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- sequential by design: copyPages mutates the shared output document
    const [page] = await merged.copyPages(slide, [0])
    merged.addPage(page)
  }

  if (merged.getPageCount() === 0) {
    throw new Error('The deck produced no printable pages.')
  }

  return Buffer.from(await merged.save())
}

export function createDeckExportGenerator(config: DeckRenderWindowConfig) {
  return async ({ html, title }: DeckExportRequest): Promise<Buffer> => {
    const slidePdfs = await withDeckRenderWindow(
      config,
      { html },
      {
        label: DECK_EXPORT_LABEL,
        maxSlides: DECK_EXPORT_MAX_SLIDES,
        timeoutMs: DECK_EXPORT_TIMEOUT_MS,
        // printToPDF is unreliable against an offscreen compositing target.
        offscreen: false,
      },
      async ({ window, slideIndexes, gotoSlide }) => {
        await window.webContents.insertCSS(DECK_EXPORT_PRINT_CSS)
        const pages: Uint8Array[] = []

        for (const index of slideIndexes) {
          // react-doctor-disable-next-line react-doctor/async-await-in-loop -- sequential by design: each slide must be navigated to and settled before it can be printed (ordered side effects)
          await gotoSlide(index)
          // react-doctor-disable-next-line react-doctor/async-await-in-loop -- sequential by design: one print per settled slide, in slide order
          const page = await window.webContents.printToPDF({
            pageSize: {
              width: DECK_EXPORT_PAGE_WIDTH_INCHES,
              height: DECK_EXPORT_PAGE_HEIGHT_INCHES,
            },
            margins: { marginType: 'none' },
            printBackground: true,
            preferCSSPageSize: false,
            scale: 1,
          })
          pages.push(page)
        }

        return pages
      },
    )

    return mergeSlidePdfs(slidePdfs, title)
  }
}

/**
 * Smoke-test assertion for an exported deck: the right number of pages, at the
 * slide's own size, carrying real text rather than a raster. A font resource on
 * every page is what separates a printed deck from a screenshot of one.
 */
export async function inspectExportedPdf(pdf: Buffer, expectedPages = 2) {
  const fail = (detail: string) => ({ ok: false as const, detail })

  if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') return fail('Export is not a PDF.')

  const document = await PDFDocument.load(pdf)
  if (document.getPageCount() !== expectedPages) {
    return fail(`Export has ${document.getPageCount()} pages, expected ${expectedPages}.`)
  }

  const { width, height } = document.getPage(0).getSize()
  const expectedWidth = DECK_EXPORT_PAGE_WIDTH_INCHES * 72
  const expectedHeight = DECK_EXPORT_PAGE_HEIGHT_INCHES * 72
  if (Math.abs(width - expectedWidth) > 1 || Math.abs(height - expectedHeight) > 1) {
    return fail(`Export page is ${width}x${height}pt, expected ${expectedWidth}x${expectedHeight}.`)
  }

  for (const page of document.getPages()) {
    const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict)
    if (!fonts || fonts.keys().length === 0) {
      return fail('Export page has no font resource; text was rasterized.')
    }
  }

  return { ok: true as const, detail: '' }
}
