import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE_SANS_PRO_LICENSE_PATH = 'runtimes/reveal.js/5.1.0/theme/fonts/source-sans-pro/LICENSE'

describe('approved runtime registry', () => {
  it('includes reveal.js, chart.js, and deck-fonts as approved runtimes', () => {
    const runtimes = getApprovedRuntimes()

    expect(runtimes).toHaveLength(3)
    expect(runtimes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'reveal.js',
          version: '5.1.0',
          runtimeMode: 'reveal',
          license: 'MIT',
        }),
        expect.objectContaining({
          id: 'chart.js',
          version: '4.5.1',
          runtimeMode: 'custom-js',
          license: 'MIT',
          previewMode: 'full-js',
          allowsDeckScripts: true,
        }),
        expect.objectContaining({
          id: 'deck-fonts',
          version: '1.0.0',
          runtimeMode: 'static',
          license: 'OFL-1.1',
          previewMode: 'css-only',
          allowsDeckScripts: false,
        }),
      ]),
    )
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

  it('looks up chart.js required UMD asset', () => {
    const runtime = getApprovedRuntime('chart.js', '4.5.1')

    expect(runtime).not.toBeNull()
    expect(runtime?.requiredAssets.js).toEqual(['chart.umd.min.js'])
    expect(runtime?.allowedGlobals).toEqual(['Chart'])
    expect(runtime?.assets).toEqual([
      expect.objectContaining({
        path: 'chart.umd.min.js',
        kind: 'script',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        size: expect.any(Number),
      }),
    ])
  })

  it('builds deterministic Ark runtime asset URLs', () => {
    expect(buildRuntimeAssetUrl('reveal.js', '5.1.0', 'reveal.js')).toBe(
      '/api/runtimes/reveal.js/5.1.0/reveal.js',
    )
    expect(buildRuntimeAssetUrl('reveal.js', '5.1.0', 'theme/white.css')).toBe(
      '/api/runtimes/reveal.js/5.1.0/theme/white.css',
    )
    expect(buildRuntimeAssetUrl('chart.js', '4.5.1', 'chart.umd.min.js')).toBe(
      '/api/runtimes/chart.js/4.5.1/chart.umd.min.js',
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
      '/api/runtimes/reveal.js/5.1.0/theme/white.css',
      '/api/runtimes/reveal.js/5.1.0/reset.css',
      '/api/runtimes/reveal.js/5.1.0/theme/fonts/source-sans-pro/source-sans-pro.css',
    ])
    expect(getApprovedRuntimeAssetUrls({ runtimeMode: 'reveal', kind: 'font' })).toEqual(
      expect.arrayContaining([
        '/api/runtimes/reveal.js/5.1.0/theme/fonts/source-sans-pro/source-sans-pro-regular.woff',
        '/api/runtimes/reveal.js/5.1.0/theme/fonts/source-sans-pro/source-sans-pro-semibold.woff',
      ]),
    )
    expect(getApprovedRuntimeAssetUrls({ runtimeMode: 'custom-js', kind: 'script' })).toEqual([
      '/api/runtimes/chart.js/4.5.1/chart.umd.min.js',
    ])
    expect(getApprovedRuntimeAssetUrls({ runtimeMode: 'static', kind: 'font' })).toEqual(
      expect.arrayContaining([
        '/api/runtimes/deck-fonts/1.0.0/carlito/carlito-latin-400-normal.woff2',
        '/api/runtimes/deck-fonts/1.0.0/liberation-sans/LiberationSans-Regular.ttf',
      ]),
    )
    expect(
      getApprovedRuntimeAssetUrls({ runtimeMode: 'static', kind: 'font' }).every((url) =>
        url.startsWith('/api/runtimes/deck-fonts/1.0.0/'),
      ),
    ).toBe(true)
  })

  it('keeps the Source Sans Pro OFL license next to vendored reveal.js fonts', () => {
    const runtime = getApprovedRuntime('reveal.js', '5.1.0')

    expect(existsSync(path.join(ROOT, SOURCE_SANS_PRO_LICENSE_PATH))).toBe(true)
    expect(
      runtime?.assets.some((asset) => asset.path === 'theme/fonts/source-sans-pro/LICENSE'),
    ).toBe(false)
  })

  it('keeps the Chart.js MIT license next to the vendored UMD asset', () => {
    const runtime = getApprovedRuntime('chart.js', '4.5.1')

    expect(existsSync(path.join(ROOT, 'runtimes/chart.js/4.5.1/LICENSE.md'))).toBe(true)
    expect(runtime?.assets.some((asset) => asset.path === 'LICENSE.md')).toBe(false)
  })

  it('keeps OFL licenses next to vendored metric-clone fonts', () => {
    const runtime = getApprovedRuntime('deck-fonts', '1.0.0')
    const families = [
      'carlito',
      'caladea',
      'gelasio',
      'liberation-sans',
      'liberation-serif',
      'liberation-mono',
    ]

    expect(
      runtime?.assets.every((asset) => asset.kind === 'font' && asset.license === 'OFL-1.1'),
    ).toBe(true)

    for (const family of families) {
      expect(existsSync(path.join(ROOT, `runtimes/deck-fonts/1.0.0/${family}/LICENSE`))).toBe(true)
      expect(runtime?.assets.some((asset) => asset.path === `${family}/LICENSE`)).toBe(false)
    }
  })

  it('rejects unapproved runtime asset references', () => {
    expect(isApprovedRuntimeAssetUrl('/api/runtimes/reveal.js/4.0.0/reveal.js')).toBe(false)
    expect(isApprovedRuntimeAssetUrl('/api/runtimes/evil.js/1.0.0/evil.js')).toBe(false)
    expect(isApprovedRuntimeAssetUrl('https://cdn.example.com/reveal.js')).toBe(false)
    expect(isApprovedRuntimeAssetUrl('/api/runtimes/chart.js/3.0.0/chart.umd.min.js')).toBe(false)
    expect(
      isApprovedRuntimeAssetUrl(
        'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
      ),
    ).toBe(false)
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

    const chartApproved = validateRuntimeAssetReferences(
      ['/api/runtimes/chart.js/4.5.1/chart.umd.min.js'],
      {
        arkRuntimeLib: 'chart.js',
        arkRuntimeVersion: '4.5.1',
      },
    )

    expect(chartApproved).toEqual([])

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

    const missingChartAssets = validateRuntimeAssetReferences([], {
      arkRuntimeLib: 'chart.js',
      arkRuntimeVersion: '4.5.1',
    })

    expect(missingChartAssets.some((issue) => issue.code === 'missing_runtime_assets')).toBe(true)
  })

  it('validates reveal decks with a Chart.js addon', () => {
    const approved = validateRuntimeAssetReferences(
      [
        '/api/runtimes/reveal.js/5.1.0/reveal.css',
        '/api/runtimes/reveal.js/5.1.0/theme/white.css',
        '/api/runtimes/reveal.js/5.1.0/reveal.js',
        '/api/runtimes/chart.js/4.5.1/chart.umd.min.js',
      ],
      {
        arkRuntimeLib: 'reveal.js',
        arkRuntimeVersion: '5.1.0',
      },
      {
        arkRuntimeAddonLib: 'chart.js',
        arkRuntimeAddonVersion: '4.5.1',
      },
    )

    expect(approved).toEqual([])
  })

  it('rejects Chart.js assets on reveal decks without a complete addon declaration', () => {
    const withoutAddon = validateRuntimeAssetReferences(
      [
        '/api/runtimes/reveal.js/5.1.0/reveal.css',
        '/api/runtimes/reveal.js/5.1.0/theme/white.css',
        '/api/runtimes/reveal.js/5.1.0/reveal.js',
        '/api/runtimes/chart.js/4.5.1/chart.umd.min.js',
      ],
      {
        arkRuntimeLib: 'reveal.js',
        arkRuntimeVersion: '5.1.0',
      },
    )

    expect(withoutAddon.some((issue) => issue.code === 'runtime_version_mismatch')).toBe(true)

    const incompleteAddon = validateRuntimeAssetReferences(
      [
        '/api/runtimes/reveal.js/5.1.0/reveal.css',
        '/api/runtimes/reveal.js/5.1.0/theme/white.css',
        '/api/runtimes/reveal.js/5.1.0/reveal.js',
        '/api/runtimes/chart.js/4.5.1/chart.umd.min.js',
      ],
      {
        arkRuntimeLib: 'reveal.js',
        arkRuntimeVersion: '5.1.0',
      },
      {
        arkRuntimeAddonLib: 'chart.js',
        arkRuntimeAddonVersion: null,
      },
    )

    expect(incompleteAddon.some((issue) => issue.code === 'runtime_version_mismatch')).toBe(true)
  })

  it('rejects incomplete primary and addon runtime marker pairs', () => {
    const incompletePrimary = validateRuntimeAssetReferences(
      ['/api/runtimes/chart.js/4.5.1/chart.umd.min.js'],
      {
        arkRuntimeLib: 'chart.js',
        arkRuntimeVersion: null,
      },
    )

    expect(incompletePrimary.some((issue) => issue.code === 'runtime_version_mismatch')).toBe(true)
    expect(
      incompletePrimary.some((issue) =>
        issue.message.includes('data-ark-runtime-lib and data-ark-runtime-version'),
      ),
    ).toBe(true)

    const incompletePrimaryVersionOnly = validateRuntimeAssetReferences(
      ['/api/runtimes/chart.js/4.5.1/chart.umd.min.js'],
      {
        arkRuntimeLib: null,
        arkRuntimeVersion: '4.5.1',
      },
    )

    expect(
      incompletePrimaryVersionOnly.some((issue) => issue.code === 'runtime_version_mismatch'),
    ).toBe(true)

    const incompleteAddonVersionOnly = validateRuntimeAssetReferences(
      [
        '/api/runtimes/reveal.js/5.1.0/reveal.css',
        '/api/runtimes/reveal.js/5.1.0/theme/white.css',
        '/api/runtimes/reveal.js/5.1.0/reveal.js',
      ],
      {
        arkRuntimeLib: 'reveal.js',
        arkRuntimeVersion: '5.1.0',
      },
      {
        arkRuntimeAddonLib: null,
        arkRuntimeAddonVersion: '4.5.1',
      },
    )

    expect(
      incompleteAddonVersionOnly.some((issue) =>
        issue.message.includes('data-ark-runtime-addon-lib and data-ark-runtime-addon-version'),
      ),
    ).toBe(true)
  })

  it('includes approved runtimes in generation guidance', () => {
    const prompt = buildRuntimeRegistryPromptSection()

    expect(prompt).toContain('reveal.js@5.1.0')
    expect(prompt).toContain('/api/runtimes/reveal.js/5.1.0/reveal.js')
    expect(prompt).toContain('chart.js@4.5.1')
    expect(prompt).toContain('/api/runtimes/chart.js/4.5.1/chart.umd.min.js')
    expect(prompt).toContain('data-ark-runtime="chart"')
    expect(prompt).not.toContain('deck-fonts@1.0.0')
    expect(prompt).not.toContain('data-ark-runtime-lib="deck-fonts"')
  })
})
