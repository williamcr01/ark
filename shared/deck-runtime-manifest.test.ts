import { describe, expect, it } from 'vitest'

import {
  composeDeckRuntimeManifest,
  DECK_RUNTIME_MANIFEST_SCHEMA_VERSION,
  deserializeDeckRuntimeManifest,
  isDeckRuntimeManifest,
  manifestIndicatesScriptStripping,
  parseDeckRuntimeManifest,
  serializeDeckRuntimeManifest,
  type DeckRuntimeManifest,
} from './deck-runtime-manifest.ts'

function sampleManifest(): DeckRuntimeManifest {
  return composeDeckRuntimeManifest({
    validation: {
      valid: true,
      slideCount: 2,
      scripts: [],
      externalUrls: [],
      runtimeMode: 'static',
      approvedRuntimeId: null,
      approvedRuntimeVersion: null,
      issues: [],
    },
    parsed: {
      structure: 'plain',
      slideSelector: 'section.slide',
      slideCount: 2,
      assets: [],
    },
    usesRevealAdapter: false,
  })
}

describe('deck runtime manifest serialization', () => {
  it('round-trips through JSON', () => {
    const manifest = sampleManifest()
    const serialized = serializeDeckRuntimeManifest(manifest)
    const restored = deserializeDeckRuntimeManifest(serialized)

    expect(restored).toEqual(manifest)
    expect(isDeckRuntimeManifest(restored)).toBe(true)
  })

  it('rejects unknown schema versions', () => {
    expect(isDeckRuntimeManifest({ schemaVersion: 99, runtimeMode: 'static' })).toBe(false)
  })

  it('rejects partial manifests missing nested consumer fields', () => {
    const manifest = sampleManifest()

    expect(isDeckRuntimeManifest({ ...manifest, scripts: { inline: 0 } })).toBe(false)
    expect(isDeckRuntimeManifest({ ...manifest, warnings: ['ok', 1] })).toBe(false)
    expect(isDeckRuntimeManifest({ ...manifest, network: { externalUrls: [] } })).toBe(false)
    expect(isDeckRuntimeManifest({ ...manifest, validation: { valid: true } })).toBe(false)
    expect(isDeckRuntimeManifest({ ...manifest, assets: [{ kind: 'script', url: '/x' }] })).toBe(
      false,
    )
    expect(isDeckRuntimeManifest({ ...manifest, usesRevealAdapter: 'yes' })).toBe(false)
  })

  it('treats corrupt stored metadata as absent', () => {
    const manifest = sampleManifest()
    const corrupt = {
      schemaVersion: DECK_RUNTIME_MANIFEST_SCHEMA_VERSION,
      runtimeMode: 'static',
      previewMode: 'css-only',
      slideCount: manifest.slideCount,
    }

    expect(parseDeckRuntimeManifest(corrupt)).toBeNull()
    expect(deserializeDeckRuntimeManifest(JSON.stringify(corrupt))).toBeNull()
  })

  it('does not treat partial manifests as script-stripping', () => {
    expect(
      manifestIndicatesScriptStripping({
        previewMode: 'css-only',
        scripts: undefined as unknown as DeckRuntimeManifest['scripts'],
      }),
    ).toBe(false)
  })
})

describe('composeDeckRuntimeManifest', () => {
  it('marks external assets as unapproved', () => {
    const manifest = composeDeckRuntimeManifest({
      validation: {
        valid: false,
        slideCount: 1,
        scripts: [{ inline: false, src: 'https://evil.example/script.js' }],
        externalUrls: ['https://evil.example/script.js'],
        runtimeMode: 'static',
        approvedRuntimeId: null,
        approvedRuntimeVersion: null,
        issues: [
          {
            code: 'external_url',
            message: 'External URL blocked.',
            severity: 'error',
          },
        ],
      },
      parsed: {
        structure: 'plain',
        slideSelector: 'section.slide',
        slideCount: 1,
        assets: [{ kind: 'script', url: 'https://evil.example/script.js' }],
      },
      usesRevealAdapter: false,
    })

    expect(manifest.assets[0]?.approved).toBe(false)
    expect(manifest.network.externalUrls).toContain('https://evil.example/script.js')
  })
})
