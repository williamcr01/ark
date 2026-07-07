import { describe, expect, it } from 'vitest'

import {
  buildAssetUrl,
  getAssetCategory,
  isAllowedAssetMediaType,
  isArkAssetUrl,
  isSuspiciousAssetFilename,
  parseAssetIdFromUrl,
  sanitizeAssetFilename,
} from './assets.ts'

const ASSET_ID = '00000000-0000-4000-8000-000000000001'
const DECK_ID = '00000000-0000-4000-8000-000000000002'

describe('media type helpers', () => {
  it('allows known types and rejects others', () => {
    expect(isAllowedAssetMediaType('image/png')).toBe(true)
    expect(isAllowedAssetMediaType('image/png; charset=binary')).toBe(true)
    expect(isAllowedAssetMediaType('application/x-msdownload')).toBe(false)
  })

  it('classifies categories', () => {
    expect(getAssetCategory('image/jpeg')).toBe('image')
    expect(getAssetCategory('text/csv')).toBe('text')
    expect(getAssetCategory('application/pdf')).toBe('pdf')
    expect(getAssetCategory('application/x-thing')).toBe('other')
  })
})

describe('asset URLs', () => {
  it('builds and parses deck-scoped Ark asset URLs', () => {
    expect(buildAssetUrl(DECK_ID, ASSET_ID)).toBe(`/api/decks/${DECK_ID}/assets/${ASSET_ID}`)
    expect(parseAssetIdFromUrl(`/api/decks/${DECK_ID}/assets/${ASSET_ID}`)).toBe(ASSET_ID)
    expect(parseAssetIdFromUrl(`/api/decks/${DECK_ID}/assets/${ASSET_ID}?x=1`)).toBe(ASSET_ID)
    expect(isArkAssetUrl(`/api/decks/${DECK_ID}/assets/${ASSET_ID}`)).toBe(true)
  })

  it('still parses legacy /api/assets/:id URLs for chat replay', () => {
    expect(parseAssetIdFromUrl(`/api/assets/${ASSET_ID}`)).toBe(ASSET_ID)
    expect(isArkAssetUrl(`/api/assets/${ASSET_ID}`)).toBe(true)
  })

  it('rejects non-asset and external URLs', () => {
    expect(parseAssetIdFromUrl('https://example.com/logo.png')).toBeNull()
    expect(parseAssetIdFromUrl('/api/assets/not-a-uuid')).toBeNull()
    expect(isArkAssetUrl('https://evil.example/api/assets/x')).toBe(false)
    expect(
      parseAssetIdFromUrl(`https://evil.example/api/decks/${DECK_ID}/assets/${ASSET_ID}`),
    ).toBeNull()
    expect(isArkAssetUrl(`https://evil.example/api/decks/${DECK_ID}/assets/${ASSET_ID}`)).toBe(
      false,
    )
    expect(parseAssetIdFromUrl(`//evil.example/api/decks/${DECK_ID}/assets/${ASSET_ID}`)).toBeNull()
  })
})

describe('filename safety', () => {
  it('sanitizes to a safe basename', () => {
    expect(sanitizeAssetFilename('folder/sub/logo.png')).toBe('logo.png')
    expect(sanitizeAssetFilename('a<b>c.png')).toBe('abc.png')
  })

  it('flags traversal and empty filenames', () => {
    expect(isSuspiciousAssetFilename('../secret.png')).toBe(true)
    expect(isSuspiciousAssetFilename('a/b.png')).toBe(true)
    expect(isSuspiciousAssetFilename('..')).toBe(true)
    expect(isSuspiciousAssetFilename('logo.png')).toBe(false)
  })
})
