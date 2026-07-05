import { describe, expect, it } from 'vitest'

import {
  buildRuntimeAssetUrl,
  buildRuntimeRegistryPromptSection,
  getApprovedRuntime,
  getApprovedRuntimeAssetUrls,
  getApprovedRuntimes,
  isApprovedRuntimeAssetUrl,
  lookupRuntimeAsset,
  parseRuntimeAssetUrl,
  validateRuntimeAssetReferences,
} from './deck-runtime-registry'

describe('approved runtime registry', () => {
  it('includes reveal.js as the initial approved runtime', () => {
    const runtimes = getApprovedRuntimes()

    expect(runtimes).toHaveLength(1)
    expect(runtimes[0]).toMatchObject({
      id: 'reveal.js',
      version: '5.1.0',
      runtimeMode: 'reveal',
      license: 'MIT',
    })
  })

  it('looks up runtimes by pinned id and version', () => {
    const runtime = getApprovedRuntime('reveal.js', '5.1.0')

    expect(runtime).not.toBeNull()
    expect(runtime?.requiredAssets.js).toEqual(['reveal.js'])
    expect(runtime?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'reveal.js',
          kind: 'script',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    )
  })

  it('builds deterministic Ark runtime asset URLs', () => {
    expect(buildRuntimeAssetUrl('reveal.js', '5.1.0', 'reveal.js')).toBe(
      '/api/runtimes/reveal.js/5.1.0/reveal.js',
    )
    expect(buildRuntimeAssetUrl('reveal.js', '5.1.0', 'theme/white.css')).toBe(
      '/api/runtimes/reveal.js/5.1.0/theme/white.css',
    )
  })

  it('parses and validates approved runtime asset references', () => {
    const url = '/api/runtimes/reveal.js/5.1.0/reveal.js'
    const ref = parseRuntimeAssetUrl(url)

    expect(ref).toEqual({
      runtimeId: 'reveal.js',
      version: '5.1.0',
      assetPath: 'reveal.js',
    })
    expect(isApprovedRuntimeAssetUrl(url)).toBe(true)
    expect(isApprovedRuntimeAssetUrl(url, 'script')).toBe(true)
    expect(isApprovedRuntimeAssetUrl(url, 'stylesheet')).toBe(false)
    expect(lookupRuntimeAsset(ref!)).toMatchObject({
      runtime: { id: 'reveal.js', version: '5.1.0' },
      asset: { path: 'reveal.js' },
    })
  })

  it('lists approved runtime asset URLs by mode and kind', () => {
    expect(getApprovedRuntimeAssetUrls({ runtimeMode: 'reveal', kind: 'script' })).toEqual([
      '/api/runtimes/reveal.js/5.1.0/reveal.js',
    ])
    expect(getApprovedRuntimeAssetUrls({ runtimeMode: 'reveal', kind: 'stylesheet' })).toEqual([
      '/api/runtimes/reveal.js/5.1.0/reveal.css',
      '/api/runtimes/reveal.js/5.1.0/reset.css',
      '/api/runtimes/reveal.js/5.1.0/theme/white.css',
    ])
  })

  it('rejects unapproved runtime asset references', () => {
    expect(isApprovedRuntimeAssetUrl('/api/runtimes/reveal.js/4.0.0/reveal.js')).toBe(false)
    expect(isApprovedRuntimeAssetUrl('/api/runtimes/evil.js/1.0.0/evil.js')).toBe(false)
    expect(isApprovedRuntimeAssetUrl('https://cdn.example.com/reveal.js')).toBe(false)
  })

  it('validates required assets and version mismatches', () => {
    const approved = validateRuntimeAssetReferences(
      [
        '/api/runtimes/reveal.js/5.1.0/reveal.css',
        '/api/runtimes/reveal.js/5.1.0/theme/white.css',
        '/api/runtimes/reveal.js/5.1.0/reveal.js',
      ],
      {
        arkRuntimeLib: 'reveal.js',
        arkRuntimeVersion: '5.1.0',
      },
    )

    expect(approved).toEqual([])

    const versionMismatch = validateRuntimeAssetReferences(
      ['/api/runtimes/reveal.js/4.0.0/reveal.js'],
      {
        arkRuntimeLib: 'reveal.js',
        arkRuntimeVersion: '5.1.0',
      },
    )

    expect(versionMismatch.some((issue) => issue.code === 'runtime_version_mismatch')).toBe(true)

    const missingAssets = validateRuntimeAssetReferences([], {
      arkRuntimeLib: 'reveal.js',
      arkRuntimeVersion: '5.1.0',
    })

    expect(missingAssets.some((issue) => issue.code === 'missing_runtime_assets')).toBe(true)
  })

  it('includes approved runtimes in generation guidance', () => {
    const prompt = buildRuntimeRegistryPromptSection()

    expect(prompt).toContain('reveal.js@5.1.0')
    expect(prompt).toContain('/api/runtimes/reveal.js/5.1.0/reveal.js')
  })
})
