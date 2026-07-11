import { afterEach, describe, expect, it, vi } from 'vitest'

import hostileScriptsDeck from '@fixtures/hostile-scripts-deck.html?raw'
import plainCssDeck from '@fixtures/plain-css-deck.html?raw'
import revealRegistryDeck from '@fixtures/reveal-registry-deck.html?raw'

import { analyzeDeckInBrowser } from './deck-analysis'

describe('analyzeDeckInBrowser', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('derives slides, validation, runtime manifest, and executable flags from one parse', () => {
    const parseSpy = vi.spyOn(DOMParser.prototype, 'parseFromString')

    const analysis = analyzeDeckInBrowser(hostileScriptsDeck)

    expect(parseSpy).toHaveBeenCalledTimes(1)
    expect(analysis.slideCount).toBe(2)
    expect(analysis.validation.slideCount).toBe(2)
    expect(analysis.runtimeManifest.slideCount).toBe(2)
    expect(analysis.runtimeMode).toBe('static')
    expect(analysis.runtimeManifest.runtimeMode).toBe('static')
    expect(analysis.validation.scripts.length).toBeGreaterThan(0)
    expect(analysis.hasExecutableContent).toBe(true)
    expect(analysis.usesStaticPreview).toBe(true)

    expect(analysis.getThumbnailSrcDoc(0)).toContain('Content-Security-Policy')
    expect(parseSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps plain CSS decks on non-executable static preview', () => {
    const analysis = analyzeDeckInBrowser(plainCssDeck)

    expect(analysis.slideCount).toBe(3)
    expect(analysis.runtimeMode).toBe('static')
    expect(analysis.runtimeManifest.previewMode).toBe('css-only')
    expect(analysis.hasExecutableContent).toBe(false)
    expect(analysis.usesStaticPreview).toBe(false)
  })

  it('recognizes approved Reveal runtime decks without marking them as static previews', () => {
    const analysis = analyzeDeckInBrowser(revealRegistryDeck)

    expect(analysis.runtimeMode).toBe('reveal')
    expect(analysis.runtimeManifest.previewMode).toBe('full-js')
    expect(analysis.runtimeManifest.usesRevealAdapter).toBe(true)
    expect(analysis.hasExecutableContent).toBe(true)
    expect(analysis.usesStaticPreview).toBe(false)
  })
})
