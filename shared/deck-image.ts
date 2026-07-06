import type { EditorNormalizedRect } from './deck-editor-bridge.ts'
import { clampNormalizedRect } from './deck-text-box.ts'
import {
  ARK_EDITABLE_ATTR,
  ARK_MANAGED_ATTR,
  ARK_SLIDE_REFERENCE_HEIGHT,
  ARK_SLIDE_REFERENCE_WIDTH,
} from './deck-metadata.ts'
import { isExternalUrl } from './deck-network.ts'

/** Editable kind value for Ark-managed images. */
export const ARK_IMAGE_EDITABLE_VALUE = 'image' as const

/** Supported raster image MIME types for manual insertion (issue #76). */
export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number]

/** Default max embedded image size (5 MiB). */
export const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024

/** Default max width as a fraction of the slide (50%). */
export const DEFAULT_MAX_IMAGE_WIDTH_FRACTION = 0.5

export type ImageFitMode = 'contain' | 'cover' | 'fill'

export type DeckAssetRef =
  | { kind: 'data-url'; mimeType: string; dataUrl: string }
  | { kind: 'asset-id'; id: string; url: string }

export type ImageValidationSuccess = { ok: true }
export type ImageValidationFailure = { ok: false; error: string }
export type ImageValidationResult = ImageValidationSuccess | ImageValidationFailure

const SUPPORTED_MIME_SET = new Set<string>(SUPPORTED_IMAGE_MIME_TYPES)

const DATA_URL_IMAGE_PATTERN = /^data:(image\/[^;]+);base64,/i

const REMOTE_IMAGE_URL_PATTERN = /^https?:\/\/.+\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i

export function validateImageMimeType(mimeType: string): ImageValidationResult {
  const normalized = mimeType.toLowerCase().trim()

  if (normalized === 'image/svg+xml' || normalized === 'image/svg') {
    return {
      ok: false,
      error: 'SVG images are not supported because they can contain active content.',
    }
  }

  if (!SUPPORTED_MIME_SET.has(normalized)) {
    return {
      ok: false,
      error: `Unsupported image type "${mimeType}". Use PNG, JPEG, WebP, or GIF.`,
    }
  }

  return { ok: true }
}

export function validateImageFileSize(sizeBytes: number): ImageValidationResult {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: 'Image file is empty.' }
  }

  if (sizeBytes > MAX_IMAGE_FILE_SIZE_BYTES) {
    const maxMb = Math.round(MAX_IMAGE_FILE_SIZE_BYTES / (1024 * 1024))
    return {
      ok: false,
      error: `Image is too large. Maximum size is ${maxMb} MB.`,
    }
  }

  return { ok: true }
}

export function validateImageFile(file: { type: string; size: number }): ImageValidationResult {
  const mimeResult = validateImageMimeType(file.type)

  if (!mimeResult.ok) {
    return mimeResult
  }

  return validateImageFileSize(file.size)
}

export function parseDataUrlImage(
  dataUrl: string,
): { mimeType: SupportedImageMimeType; dataUrl: string } | ImageValidationFailure {
  const trimmed = dataUrl.trim()
  const match = DATA_URL_IMAGE_PATTERN.exec(trimmed)

  if (!match?.[1]) {
    return { ok: false, error: 'Image must be embedded as a base64 data URL.' }
  }

  const mimeResult = validateImageMimeType(match[1])

  if (!mimeResult.ok) {
    return mimeResult
  }

  return {
    mimeType: match[1].toLowerCase() as SupportedImageMimeType,
    dataUrl: trimmed,
  }
}

export function validateImageSrcForInsert(src: string | null | undefined): ImageValidationResult {
  const trimmed = src?.trim() ?? ''

  if (!trimmed) {
    return { ok: false, error: 'Image src must not be empty.' }
  }

  if (isExternalUrl(trimmed)) {
    return {
      ok: false,
      error:
        'Remote image URLs cannot be inserted into deck HTML. Use a local file or paste image data.',
    }
  }

  if (trimmed.startsWith('blob:')) {
    return {
      ok: false,
      error: 'Blob URLs are not portable. Embed the image as a data URL before saving.',
    }
  }

  const parsed = parseDataUrlImage(trimmed)

  if ('ok' in parsed && parsed.ok === false) {
    return parsed
  }

  if ('error' in parsed) {
    return parsed
  }

  return { ok: true }
}

export function isRemoteImageUrl(value: string): boolean {
  const trimmed = value.trim()

  if (!isExternalUrl(trimmed)) {
    return false
  }

  return REMOTE_IMAGE_URL_PATTERN.test(trimmed) || trimmed.includes('/image')
}

export function formatNormalizedToPixels(normalized: number, reference: number) {
  return `${Math.round(normalized * reference)}px`
}

export type ComputeImageGeometryOptions = {
  position?: { x: number; y: number }
  maxWidthFraction?: number
}

/**
 * Compute a normalized slide rect that preserves aspect ratio and fits within
 * the default max width while centering on `position` (slide fractions).
 */
export function computeImageGeometry(
  naturalWidth: number,
  naturalHeight: number,
  options: ComputeImageGeometryOptions = {},
): EditorNormalizedRect {
  const position = options.position ?? { x: 0.5, y: 0.5 }
  const maxWidthFraction = options.maxWidthFraction ?? DEFAULT_MAX_IMAGE_WIDTH_FRACTION

  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0) {
    return clampNormalizedRect({
      x: position.x - maxWidthFraction / 2,
      y: position.y - maxWidthFraction / 4,
      width: maxWidthFraction,
      height: maxWidthFraction * (ARK_SLIDE_REFERENCE_WIDTH / ARK_SLIDE_REFERENCE_HEIGHT) * 0.75,
    })
  }

  const maxPixelWidth = maxWidthFraction * ARK_SLIDE_REFERENCE_WIDTH
  const scale = Math.min(1, maxPixelWidth / naturalWidth)
  const pixelWidth = naturalWidth * scale
  const pixelHeight = naturalHeight * scale
  const width = pixelWidth / ARK_SLIDE_REFERENCE_WIDTH
  const height = pixelHeight / ARK_SLIDE_REFERENCE_HEIGHT

  return clampNormalizedRect({
    x: position.x - width / 2,
    y: position.y - height / 2,
    width,
    height,
  })
}

export type BuildImageHtmlOptions = {
  alt?: string
  fit?: ImageFitMode
  aspectRatio?: number
}

export function buildImageHtml(
  geometry: EditorNormalizedRect,
  asset: Extract<DeckAssetRef, { kind: 'data-url' }>,
  options: BuildImageHtmlOptions = {},
) {
  const srcValidation = validateImageSrcForInsert(asset.dataUrl)

  if (!srcValidation.ok) {
    throw new Error(srcValidation.error)
  }

  const rect = clampNormalizedRect(geometry)
  const fit = options.fit ?? 'contain'
  const alt = options.alt ?? ''
  const styleEntries: Array<[string, string]> = [
    ['position', 'absolute'],
    ['left', formatNormalizedToPixels(rect.x, ARK_SLIDE_REFERENCE_WIDTH)],
    ['top', formatNormalizedToPixels(rect.y, ARK_SLIDE_REFERENCE_HEIGHT)],
    ['width', formatNormalizedToPixels(rect.width, ARK_SLIDE_REFERENCE_WIDTH)],
    ['height', formatNormalizedToPixels(rect.height, ARK_SLIDE_REFERENCE_HEIGHT)],
    ['object-fit', fit],
    ['z-index', '1'],
  ]
  const styleText = styleEntries.map(([property, value]) => `${property}: ${value}`).join('; ')
  const attrs = [
    `${ARK_EDITABLE_ATTR}="${ARK_IMAGE_EDITABLE_VALUE}"`,
    `${ARK_MANAGED_ATTR}="true"`,
    `alt="${escapeHtmlAttribute(alt)}"`,
    `src="${escapeHtmlAttribute(asset.dataUrl)}"`,
    `style="${styleText}"`,
  ]

  if (options.aspectRatio && Number.isFinite(options.aspectRatio) && options.aspectRatio > 0) {
    attrs.push(`data-ark-aspect-ratio="${options.aspectRatio}"`)
  }

  if (fit !== 'contain') {
    attrs.push(`data-ark-fit="${fit}"`)
  }

  return `<img ${attrs.join(' ')} />`
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
