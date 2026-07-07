import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import hostileScriptsDeck from '@fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'

import { downloadHtml } from './deck-io'

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
})
