// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { buildThumbnailSrcDoc } from './thumbnail-html.ts'

describe('buildThumbnailSrcDoc', () => {
  it('injects absolutized metric-clone @font-face rules', () => {
    const doc = new DOMParser().parseFromString(
      `<!DOCTYPE html><html><head></head><body><section class="slide"><h1>One</h1></section></body></html>`,
      'text/html',
    )
    const srcDoc = buildThumbnailSrcDoc(doc, 0, '', '', 'static', {
      assetOrigin: 'http://localhost:8787',
    })
    const css =
      new DOMParser()
        .parseFromString(srcDoc, 'text/html')
        .querySelector('style[data-ark-metric-fonts]')?.textContent ?? ''

    expect(css).toContain('font-family: "Carlito"')
    expect(css).toContain(
      'url("http://localhost:8787/api/runtimes/deck-fonts/1.0.0/carlito/carlito-latin-400-normal.woff2")',
    )
    expect(css).toContain('local("Liberation Sans")')
    expect(css).not.toContain('font-family: "Calibri"')
  })
})
