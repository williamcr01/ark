import { describe, expect, it } from 'vitest'

import {
  buildImageHtml,
  computeImageGeometry,
  estimateDataUrlDecodedSize,
  isRemoteImageUrl,
  MAX_IMAGE_FILE_SIZE_BYTES,
  parseDataUrlImage,
  validateImageDataUrlSize,
  validateImageFile,
  validateImageMimeType,
  validateImageSrcForInsert,
} from './deck-image.ts'

const tinyPngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('validateImageMimeType', () => {
  it('accepts supported raster types', () => {
    expect(validateImageMimeType('image/png').ok).toBe(true)
    expect(validateImageMimeType('image/jpeg').ok).toBe(true)
    expect(validateImageMimeType('image/webp').ok).toBe(true)
    expect(validateImageMimeType('image/gif').ok).toBe(true)
  })

  it('rejects SVG', () => {
    const result = validateImageMimeType('image/svg+xml')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/SVG/i)
    }
  })

  it('rejects unsupported types', () => {
    const result = validateImageMimeType('image/bmp')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Unsupported/i)
    }
  })
})

describe('validateImageFile', () => {
  it('rejects files over the size limit', () => {
    const result = validateImageFile({
      type: 'image/png',
      size: MAX_IMAGE_FILE_SIZE_BYTES + 1,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/too large/i)
    }
  })

  it('accepts valid files', () => {
    expect(
      validateImageFile({
        type: 'image/png',
        size: 1024,
      }).ok,
    ).toBe(true)
  })
})

describe('validateImageSrcForInsert', () => {
  it('accepts embedded data URLs', () => {
    expect(validateImageSrcForInsert(tinyPngDataUrl).ok).toBe(true)
  })

  it('rejects external HTTP(S) URLs', () => {
    const result = validateImageSrcForInsert('https://example.com/photo.png')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Remote image URLs/i)
    }
  })

  it('rejects blob URLs', () => {
    const result = validateImageSrcForInsert('blob:http://localhost/abc')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Blob URLs/i)
    }
  })

  it('rejects oversized embedded data URLs', () => {
    const oversizedPayload = 'A'.repeat(Math.ceil((MAX_IMAGE_FILE_SIZE_BYTES * 4) / 3) + 4)
    const result = validateImageSrcForInsert(`data:image/png;base64,${oversizedPayload}`)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/too large/i)
    }
  })
})

describe('parseDataUrlImage', () => {
  it('parses supported data URLs', () => {
    expect(parseDataUrlImage(tinyPngDataUrl)).toEqual({
      mimeType: 'image/png',
      dataUrl: tinyPngDataUrl,
    })
  })

  it('rejects SVG data URLs', () => {
    const result = parseDataUrlImage('data:image/svg+xml;base64,PHN2Zy8+')
    expect('ok' in result && result.ok === false).toBe(true)
  })
})

describe('isRemoteImageUrl', () => {
  it('detects common remote image URLs', () => {
    expect(isRemoteImageUrl('https://example.com/hero.png')).toBe(true)
    expect(isRemoteImageUrl('data:image/png;base64,abc')).toBe(false)
  })

  it('does not treat generic paths containing "image" as image URLs', () => {
    expect(isRemoteImageUrl('https://example.com/blog/image-gallery')).toBe(false)
  })
})

describe('estimateDataUrlDecodedSize', () => {
  it('estimates base64 payload size', () => {
    expect(estimateDataUrlDecodedSize(`${tinyPngDataUrl}`)).toBeGreaterThan(0)
    expect(validateImageDataUrlSize(tinyPngDataUrl).ok).toBe(true)
  })
})

describe('computeImageGeometry', () => {
  it('preserves aspect ratio within the max width', () => {
    const geometry = computeImageGeometry(1600, 900, { position: { x: 0.5, y: 0.5 } })

    expect(geometry.width).toBeCloseTo(0.5)
    expect(geometry.height).toBeCloseTo(0.5 * (900 / 1600) * (1280 / 720), 5)
    expect(geometry.x).toBeCloseTo(0.25, 5)
    expect(geometry.y).toBeGreaterThan(0)
    expect(geometry.y).toBeLessThan(1)
  })
})

describe('buildImageHtml', () => {
  it('embeds a data URL image as a managed element', () => {
    const html = buildImageHtml(
      { x: 0.1, y: 0.15, width: 0.4, height: 0.225 },
      { kind: 'data-url', mimeType: 'image/png', dataUrl: tinyPngDataUrl },
      { alt: 'Logo', aspectRatio: 16 / 9, fit: 'cover' },
    )

    expect(html).toContain('data-ark-editable="image"')
    expect(html).toContain('data-ark-managed="true"')
    expect(html).toContain('alt="Logo"')
    expect(html).toContain('object-fit: cover')
    expect(html).toContain('data-ark-fit="cover"')
    expect(html).toContain(tinyPngDataUrl)
  })

  it('rejects external src values', () => {
    expect(() =>
      buildImageHtml(
        { x: 0, y: 0, width: 0.2, height: 0.2 },
        {
          kind: 'data-url',
          mimeType: 'image/png',
          dataUrl: 'https://example.com/photo.png',
        },
      ),
    ).toThrow(/Remote image URLs/i)
  })
})
