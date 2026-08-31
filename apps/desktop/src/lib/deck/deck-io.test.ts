import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import hostileScriptsDeck from '@fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'

import { basenameFromPath, downloadHtml, isLegacyPptFile, isPptxFile } from './deck-io'

describe('PowerPoint file detection', () => {
  it('treats .pptx as importable and .ppt as legacy', () => {
    expect(isPptxFile('board.pptx')).toBe(true)
    expect(isPptxFile('board.PPTX')).toBe(true)
    expect(isLegacyPptFile('board.pptx')).toBe(false)
    expect(isLegacyPptFile('board.ppt')).toBe(true)
    expect(isLegacyPptFile('/tmp/secret.PPT')).toBe(true)
    expect(basenameFromPath('/Users/ada/Q3 Board.pptx')).toBe('Q3 Board.pptx')
  })
})

describe('downloadHtml', () => {
  let createdLinks: HTMLAnchorElement[]

  beforeEach(() => {
    createdLinks = []

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ark-test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    vi.spyOn(document.body, 'append').mockImplementation((node) => {
      if (node instanceof HTMLAnchorElement) {
        createdLinks.push(node)
      }

      return node
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('downloads the original deck unchanged by default', () => {
    downloadHtml(plainCssDeck, { baseName: 'demo-deck' })

    expect(createdLinks[0]?.download).toBe('demo-deck.html')
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
  })

  it('downloads sanitized HTML with a distinct filename', () => {
    downloadHtml(hostileScriptsDeck, { baseName: 'demo-deck', variant: 'sanitized' })

    expect(createdLinks[0]?.download).toBe('demo-deck-sanitized.html')
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
  })

  it('sanitizes deck titles into safe download filenames', () => {
    downloadHtml(plainCssDeck, { baseName: 'Q3: Board "Plan"? / 2025' })

    expect(createdLinks[0]?.download).toBe('Q3 Board Plan 2025.html')
  })

  it('falls back to a dated generic name when the title is unusable', () => {
    downloadHtml(plainCssDeck, { baseName: '***' })

    expect(createdLinks[0]?.download).toMatch(/^ark-presentation-\d{4}-\d{2}-\d{2}\.html$/)
  })
})
