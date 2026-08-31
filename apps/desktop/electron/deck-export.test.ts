/**
 * Electron main-process code: no DOM, and jsdom's realm would break
 * `instanceof` checks in libraries that run against Node's globals.
 *
 * @vitest-environment node
 */
import { PDFDocument } from 'pdf-lib'
import { BrowserWindow, session, type Session } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import type { PreviewSessionStore } from '@ark/storage/stores/preview-sessions.ts'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  session: { fromPartition: vi.fn() },
}))

import {
  createDeckExportGenerator,
  DECK_EXPORT_PAGE_HEIGHT_INCHES,
  DECK_EXPORT_PAGE_WIDTH_INCHES,
} from './deck-export.ts'

/** A one-page PDF standing in for what Chromium's print pass returns. */
async function onePagePdf(pageCount = 1) {
  const pdf = await PDFDocument.create()
  for (let index = 0; index < pageCount; index += 1) {
    pdf.addPage([DECK_EXPORT_PAGE_WIDTH_INCHES * 72, DECK_EXPORT_PAGE_HEIGHT_INCHES * 72])
  }
  return Buffer.from(await pdf.save())
}

function mockRenderWindow(options: { slideCount: number; printToPDF: () => Promise<Buffer> }) {
  let index = 0
  const webContents = {
    setWindowOpenHandler: vi.fn(),
    insertCSS: vi.fn(async () => 'key'),
    printToPDF: vi.fn(options.printToPDF),
    executeJavaScript: vi.fn(async (source: string) => {
      if (source.includes('ready: Boolean')) {
        return { ready: true, index, slideCount: options.slideCount, errors: [] }
      }
      if (source.includes('__arkThumbGoto')) {
        index = Number(source.match(/__arkThumbGoto\((\d+)\)/)?.[1] ?? 0)
        return true
      }
      if (source.includes('__arkThumbRequestSettle')) return null
      throw new Error(`Unexpected script: ${source}`)
    }),
  }
  const window = {
    loadURL: vi.fn(async () => undefined),
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
    webContents,
  }

  vi.mocked(BrowserWindow).mockImplementation(function () {
    return window as unknown as BrowserWindow
  })
  vi.mocked(session.fromPartition).mockReturnValue({
    setPermissionRequestHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn(), onBeforeSendHeaders: vi.fn() },
  } as unknown as Session)

  return { window, webContents }
}

const previewSessionStore = {
  createSession: vi.fn(() => ({ token: 'export-token' })),
  deleteSession: vi.fn(),
} as unknown as PreviewSessionStore

const config = {
  apiOrigin: 'http://127.0.0.1:8787',
  previewSessionStore,
  renderSecret: 'render-secret',
}

const twoSlideDeck = `<!DOCTYPE html><html><head></head><body>
  <section class="slide"><h1>One</h1></section>
  <section class="slide"><h1>Two</h1></section>
</body></html>`

describe('deck PDF export', () => {
  it('prints one page per slide at the slide reference size', async () => {
    const { webContents } = mockRenderWindow({
      slideCount: 2,
      printToPDF: () => onePagePdf(),
    })

    const { output } = await createDeckExportGenerator(config)({
      format: 'pdf',
      html: twoSlideDeck,
      title: 'Quarterly',
    })
    const document = await PDFDocument.load(output)

    expect(webContents.printToPDF).toHaveBeenCalledTimes(2)
    expect(document.getPageCount()).toBe(2)
    expect(document.getTitle()).toBe('Quarterly')

    const { width, height } = document.getPage(0).getSize()
    expect(width).toBeCloseTo(DECK_EXPORT_PAGE_WIDTH_INCHES * 72, 4)
    expect(height).toBeCloseTo(DECK_EXPORT_PAGE_HEIGHT_INCHES * 72, 4)
  })

  it('prints with backgrounds, no margins, and an exact 16:9 page box', async () => {
    const { webContents } = mockRenderWindow({ slideCount: 1, printToPDF: () => onePagePdf() })

    await createDeckExportGenerator(config)({
      format: 'pdf',
      html: '<!DOCTYPE html><html><body><section class="slide">One</section></body></html>',
      title: 'Solo',
    })

    expect(webContents.printToPDF).toHaveBeenCalledWith(
      expect.objectContaining({
        printBackground: true,
        margins: { marginType: 'none' },
        scale: 1,
        pageSize: {
          width: DECK_EXPORT_PAGE_WIDTH_INCHES,
          height: DECK_EXPORT_PAGE_HEIGHT_INCHES,
        },
      }),
    )
    // 1280x720 CSS px is exactly PowerPoint's widescreen slide.
    expect(DECK_EXPORT_PAGE_WIDTH_INCHES / DECK_EXPORT_PAGE_HEIGHT_INCHES).toBeCloseTo(16 / 9, 10)
  })

  it('keeps only the first page when a slide overflows onto a second', async () => {
    mockRenderWindow({ slideCount: 2, printToPDF: () => onePagePdf(3) })

    const { output } = await createDeckExportGenerator(config)({
      format: 'pdf',
      html: twoSlideDeck,
      title: 'Overflowing',
    })

    expect((await PDFDocument.load(output)).getPageCount()).toBe(2)
  })

  it('tears the render window down when printing fails', async () => {
    const { window } = mockRenderWindow({
      slideCount: 1,
      printToPDF: async () => {
        throw new Error('Print failed.')
      },
    })

    await expect(
      createDeckExportGenerator(config)({
        format: 'pdf',
        html: '<!DOCTYPE html><html><body><section class="slide">One</section></body></html>',
        title: 'Doomed',
      }),
    ).rejects.toThrow('Print failed.')

    expect(window.destroy).toHaveBeenCalled()
    expect(previewSessionStore.deleteSession).toHaveBeenCalledWith('export-token')
  })

  it('refuses a deck whose runtime slide count disagrees with the source', async () => {
    mockRenderWindow({ slideCount: 5, printToPDF: () => onePagePdf() })

    await expect(
      createDeckExportGenerator(config)({ format: 'pdf', html: twoSlideDeck, title: 'Mismatch' }),
    ).rejects.toThrow('Deck reports 5 slides at runtime; expected 2.')
  })
})
