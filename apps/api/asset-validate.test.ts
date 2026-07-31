import { describe, expect, it } from 'vitest'
import { MAX_ASSET_UPLOAD_BYTES } from '@ark/deck-core/assets.ts'

import {
  computeChecksum,
  decodeAssetPayload,
  isAssetUploadTooLarge,
  sniffMatchesMediaType,
  validateAssetUpload,
} from './asset-validate.ts'

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
])

const pngBase64 = PNG_BYTES.toString('base64')
const pngDataUrl = `data:image/png;base64,${pngBase64}`

describe('decodeAssetPayload', () => {
  it('decodes a base64 string', () => {
    expect(decodeAssetPayload(pngBase64)?.equals(PNG_BYTES)).toBe(true)
  })

  it('decodes a base64 data URL', () => {
    expect(decodeAssetPayload(pngDataUrl)?.equals(PNG_BYTES)).toBe(true)
  })

  it('rejects malformed and non-base64 payloads', () => {
    expect(decodeAssetPayload('')).toBeNull()
    expect(decodeAssetPayload('not base64 !!!')).toBeNull()
    expect(decodeAssetPayload('data:image/png,notbase64')).toBeNull()
  })
})

describe('computeChecksum', () => {
  it('is stable and content-addressed', () => {
    expect(computeChecksum(PNG_BYTES)).toBe(computeChecksum(Buffer.from(PNG_BYTES)))
    expect(computeChecksum(PNG_BYTES)).not.toBe(computeChecksum(Buffer.from('other')))
  })
})

describe('sniffMatchesMediaType', () => {
  it('matches image magic numbers', () => {
    expect(sniffMatchesMediaType(PNG_BYTES, 'image/png')).toBe(true)
    expect(sniffMatchesMediaType(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg')).toBe(true)
    expect(sniffMatchesMediaType(Buffer.from('GIF89a....'), 'image/gif')).toBe(true)
    expect(
      sniffMatchesMediaType(Buffer.from('\0\0\0\u0018ftypavif\0\0\0\0avifmif1'), 'image/avif'),
    ).toBe(true)
    expect(sniffMatchesMediaType(Buffer.from('BM....'), 'image/x-ms-bmp')).toBe(true)
    expect(
      sniffMatchesMediaType(Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]), 'image/x-icon'),
    ).toBe(true)
    expect(sniffMatchesMediaType(PNG_BYTES, 'image/apng')).toBe(true)
    expect(sniffMatchesMediaType(Buffer.from('%PDF-1.7'), 'application/pdf')).toBe(true)
  })

  it('rejects content that does not match the declared type', () => {
    expect(sniffMatchesMediaType(Buffer.from('hello'), 'image/png')).toBe(false)
    expect(sniffMatchesMediaType(PNG_BYTES, 'application/pdf')).toBe(false)
  })

  it('treats CSV/text as valid UTF-8 without control bytes', () => {
    expect(sniffMatchesMediaType(Buffer.from('a,b,c\n1,2,3'), 'text/csv')).toBe(true)
    expect(sniffMatchesMediaType(Buffer.from([0x00, 0x01, 0x02]), 'text/csv')).toBe(false)
  })

  it('recognizes svg only for xml/svg content', () => {
    expect(sniffMatchesMediaType(Buffer.from('<svg xmlns="..."></svg>'), 'image/svg+xml')).toBe(
      true,
    )
    expect(sniffMatchesMediaType(Buffer.from('not svg'), 'image/svg+xml')).toBe(false)
  })
})

describe('validateAssetUpload', () => {
  it('accepts a valid PNG upload and returns bytes + checksum', () => {
    const result = validateAssetUpload({
      filename: 'logo.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.byteSize).toBe(PNG_BYTES.length)
      expect(result.checksum).toBe(computeChecksum(PNG_BYTES))
      expect(result.filename).toBe('logo.png')
    }
  })

  it('infers a canonical type when the browser omits or aliases it', () => {
    const inferred = validateAssetUpload({
      filename: 'logo.png',
      mediaType: 'application/octet-stream',
      data: pngDataUrl,
    })
    const aliased = validateAssetUpload({
      filename: 'photo.jfif',
      mediaType: 'image/pjpeg',
      data: Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64'),
    })

    expect(inferred).toMatchObject({ ok: true, mediaType: 'image/png' })
    expect(aliased).toMatchObject({ ok: true, mediaType: 'image/jpeg' })
  })

  it('rejects unsupported media types', () => {
    const result = validateAssetUpload({
      filename: 'app.exe',
      mediaType: 'application/x-msdownload',
      data: pngBase64,
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported_media_type' } })
  })

  it('rejects an extension that does not match the media type', () => {
    const result = validateAssetUpload({
      filename: 'logo.pdf',
      mediaType: 'image/png',
      data: pngDataUrl,
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'extension_mismatch' } })
  })

  it('rejects suspicious filenames', () => {
    const result = validateAssetUpload({
      filename: '../../etc/passwd.png',
      mediaType: 'image/png',
      data: pngDataUrl,
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'suspicious_filename' } })
  })

  it('rejects content that fails sniffing', () => {
    const result = validateAssetUpload({
      filename: 'logo.png',
      mediaType: 'image/png',
      data: Buffer.from('this is not a png').toString('base64'),
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'content_mismatch' } })
  })

  it('enforces the upload byte boundary', () => {
    expect(isAssetUploadTooLarge(MAX_ASSET_UPLOAD_BYTES)).toBe(false)
    expect(isAssetUploadTooLarge(MAX_ASSET_UPLOAD_BYTES + 1)).toBe(true)
  })
})
