import { describe, expect, it } from 'vitest'

import {
  absolutizeArkAssetReferences,
  buildAssetUrl,
  getAssetCategory,
  isAllowedAssetMediaType,
  isArkAssetUrl,
  isSuspiciousAssetFilename,
  parseAssetIdFromUrl,
  resolveAssetMediaType,
  sanitizeAssetFilename,
} from './assets.ts'

const ASSET_ID = '00000000-0000-4000-8000-000000000001'
const DECK_ID = '00000000-0000-4000-8000-000000000002'

describe('media type helpers', () => {
  it('allows known types and rejects others', () => {
    expect(isAllowedAssetMediaType('image/png')).toBe(true)
    expect(isAllowedAssetMediaType('image/png; charset=binary')).toBe(true)
    expect(isAllowedAssetMediaType('image/x-ms-bmp')).toBe(true)
    expect(isAllowedAssetMediaType('image/vnd.microsoft.icon')).toBe(true)
    expect(isAllowedAssetMediaType('application/x-msdownload')).toBe(false)
  })

  it('normalizes aliases and infers missing browser media types from filenames', () => {
    expect(resolveAssetMediaType('photo.jfif', 'image/pjpeg')).toBe('image/jpeg')
    expect(resolveAssetMediaType('animation.apng', 'image/png')).toBe('image/apng')
    expect(resolveAssetMediaType('icon.ico', 'application/octet-stream')).toBe('image/x-icon')
    expect(resolveAssetMediaType('camera.heic', '')).toBe('')
    expect(resolveAssetMediaType('raw.dib', '')).toBe('')
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

  it('absolutizes only validated deck-scoped references', () => {
    const path = buildAssetUrl(DECK_ID, ASSET_ID)
    expect(absolutizeArkAssetReferences(`url("${path}")`, 'http://localhost:8787')).toBe(
      `url("http://localhost:8787${path}")`,
    )
    expect(
      absolutizeArkAssetReferences(`https://evil.example${path}`, 'http://localhost:8787'),
    ).toBe(`https://evil.example${path}`)
    expect(absolutizeArkAssetReferences('/images/logo.png', 'http://localhost:8787')).toBe(
      '/images/logo.png',
    )
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
