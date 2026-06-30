import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import hostileScriptsDeck from '@/test/fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '@/test/fixtures/plain-css-deck.html?raw'

import { downloadHtml } from './deck-io'

describe('downloadHtml', () => {
  let clickSpy: ReturnType<typeof vi.fn>
  let createdLinks: HTMLAnchorElement[]

  beforeEach(() => {
    createdLinks = []
    clickSpy = vi.fn()

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ark-test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName)

      if (tagName.toLowerCase() === 'a') {
        const link = element as HTMLAnchorElement
        link.click = clickSpy
        createdLinks.push(link)
      }

      return element
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('downloads the original deck unchanged by default', () => {
    downloadHtml(plainCssDeck, { baseName: 'demo-deck' })

    expect(createdLinks[0]?.download).toBe('demo-deck.html')
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('downloads sanitized HTML with a distinct filename', () => {
    downloadHtml(hostileScriptsDeck, { baseName: 'demo-deck', variant: 'sanitized' })

    expect(createdLinks[0]?.download).toBe('demo-deck-sanitized.html')
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})
