import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { buildDeckRuntimeManifestFromHtml } from './deck-manifest.ts'
import { validateDeckHtmlOnServer } from './deck-validate.ts'
import { manifestIndicatesScriptStripping } from '../shared/deck-runtime-manifest.ts'
import { detectRuntimeMode } from '../shared/deck-runtime.ts'

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures')

const plainCssDeck = readFileSync(path.join(fixtureDir, 'plain-css-deck.html'), 'utf8')
const revealDeck = readFileSync(path.join(fixtureDir, 'reveal-deck.html'), 'utf8')
const revealRegistryDeck = readFileSync(path.join(fixtureDir, 'reveal-registry-deck.html'), 'utf8')
const fullJsDeck = readFileSync(path.join(fixtureDir, 'full-js-deck.html'), 'utf8')
const hostileScriptsDeck = readFileSync(path.join(fixtureDir, 'hostile-scripts-deck.html'), 'utf8')
const hostileInvalidManifestDeck = readFileSync(
  path.join(fixtureDir, 'hostile-invalid-manifest-deck.html'),
  'utf8',
)

describe('buildDeckRuntimeManifestFromHtml', () => {
  it('builds a static manifest for plain CSS decks', () => {
    const manifest = buildDeckRuntimeManifestFromHtml(plainCssDeck)

    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.runtimeMode).toBe('static')
    expect(manifest.previewMode).toBe('css-only')
    expect(manifest.structure).toBe('plain')
    expect(manifest.slideCount).toBeGreaterThan(0)
    expect(manifest.validation.valid).toBe(true)
    expect(manifest.network.connectAllowed).toBe(false)
    expect(manifest.usesRevealAdapter).toBe(false)
    expect(detectRuntimeMode(plainCssDeck)).toBe(manifest.runtimeMode)
  })

  it('builds a reveal manifest for reveal decks', () => {
    const manifest = buildDeckRuntimeManifestFromHtml(revealDeck)

    expect(manifest.runtimeMode).toBe('reveal')
    expect(manifest.structure).toBe('reveal')
    expect(manifest.previewMode).toBe('css-only')
    expect(detectRuntimeMode(revealDeck)).toBe(manifest.runtimeMode)
  })

  it('builds a full-js reveal manifest when approved runtime assets are present', () => {
    const manifest = buildDeckRuntimeManifestFromHtml(revealRegistryDeck)

    expect(manifest.runtimeMode).toBe('reveal')
    expect(manifest.previewMode).toBe('full-js')
    expect(manifest.usesRevealAdapter).toBe(true)
    expect(manifest.approvedRuntime).toEqual({ id: 'reveal.js', version: '5.1.0' })
  })

  it('builds a custom-js manifest for full-js decks', () => {
    const manifest = buildDeckRuntimeManifestFromHtml(fullJsDeck)

    expect(manifest.runtimeMode).toBe('custom-js')
    expect(manifest.previewMode).toBe('full-js')
    expect(manifest.scripts.allowed).toBe(true)
    expect(manifestIndicatesScriptStripping(manifest)).toBe(false)
  })

  it('records script warnings for hostile script decks', () => {
    const validation = validateDeckHtmlOnServer(hostileScriptsDeck)
    const manifest = buildDeckRuntimeManifestFromHtml(hostileScriptsDeck, validation)

    expect(manifest.runtimeMode).toBe('static')
    expect(manifest.validation.valid).toBe(true)
    expect(manifest.validation.warnings).toBeGreaterThan(0)
    expect(manifest.scripts.inline + manifest.scripts.external).toBeGreaterThan(0)
    expect(manifest.scripts.allowed).toBe(false)
    expect(manifest.warnings.some((warning) => warning.includes('stripped'))).toBe(true)
  })

  it('flags invalid runtime markers as warnings/errors', () => {
    const validation = validateDeckHtmlOnServer(hostileInvalidManifestDeck)
    const manifest = buildDeckRuntimeManifestFromHtml(hostileInvalidManifestDeck, validation)

    expect(manifest.runtimeMode).toBe('static')
    expect(manifest.validation.errors + manifest.validation.warnings).toBeGreaterThan(0)
    expect(manifest.warnings.length).toBeGreaterThan(0)
  })
})
