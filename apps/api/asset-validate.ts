import { createHash } from 'node:crypto'

import {
  ALLOWED_ASSET_MEDIA_TYPES,
  MAX_ASSET_UPLOAD_BYTES,
  getAssetExtensions,
  isAllowedAssetMediaType,
  isSuspiciousAssetFilename,
  resolveAssetMediaType,
  sanitizeAssetFilename,
} from '@ark/deck-core/assets.ts'

export type AssetValidationError = {
  code:
    | 'empty'
    | 'too_large'
    | 'invalid_payload'
    | 'unsupported_media_type'
    | 'extension_mismatch'
    | 'suspicious_filename'
    | 'content_mismatch'
  message: string
}

export type AssetValidationSuccess = {
  ok: true
  bytes: Buffer
  mediaType: string
  filename: string
  byteSize: number
  checksum: string
}

export type AssetValidationResult =
  AssetValidationSuccess | { ok: false; error: AssetValidationError }

/**
 * Decode a base64 string or a `data:` URL payload into a Buffer. Returns null
 * when the payload is malformed.
 */
export function decodeAssetPayload(data: string): Buffer | null {
  const trimmed = data.trim()

  if (!trimmed) {
    return null
  }

  let base64 = trimmed

  if (trimmed.startsWith('data:')) {
    const commaIndex = trimmed.indexOf(',')
    if (commaIndex === -1) {
      return null
    }

    const meta = trimmed.slice(5, commaIndex)
    if (!meta.includes('base64')) {
      // Only base64 data URLs are supported for binary-safe transport.
      return null
    }

    base64 = trimmed.slice(commaIndex + 1)
  }

  const normalized = base64.replace(/\s/g, '')

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    return null
  }

  try {
    const buffer = Buffer.from(normalized, 'base64')

    // Guard against silently-truncated / non-base64 input.
    if (buffer.length === 0 && normalized.length > 0) {
      return null
    }

    return buffer
  } catch {
    return null
  }
}

export function computeChecksum(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function isAssetUploadTooLarge(byteSize: number): boolean {
  return byteSize > MAX_ASSET_UPLOAD_BYTES
}

function extensionMatchesMediaType(filename: string, mediaType: string): boolean {
  const extensions = getAssetExtensions(mediaType)
  if (extensions.length === 0) {
    return false
  }

  const lower = filename.toLowerCase()
  return extensions.some((extension) => lower.endsWith(extension))
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const GIF_MAGIC_87 = Buffer.from('GIF87a')
const GIF_MAGIC_89 = Buffer.from('GIF89a')
const PDF_MAGIC = Buffer.from('%PDF-')

function startsWith(bytes: Buffer, prefix: Buffer, offset = 0): boolean {
  if (bytes.length < offset + prefix.length) {
    return false
  }

  return bytes.subarray(offset, offset + prefix.length).equals(prefix)
}

/**
 * Sniff the byte content and confirm it is consistent with the declared media
 * type for formats that have reliable magic numbers. Text-like formats (CSV,
 * plain text, markdown, JSON, SVG) are validated as valid UTF-8 without control
 * bytes rather than by magic number.
 */
export function sniffMatchesMediaType(bytes: Buffer, mediaType: string): boolean {
  const normalized = resolveAssetMediaType('', mediaType)

  switch (normalized) {
    case 'image/png':
    case 'image/apng':
      return startsWith(bytes, PNG_MAGIC)
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    case 'image/gif':
      return startsWith(bytes, GIF_MAGIC_87) || startsWith(bytes, GIF_MAGIC_89)
    case 'image/webp':
      return startsWith(bytes, Buffer.from('RIFF')) && startsWith(bytes, Buffer.from('WEBP'), 8)
    case 'image/avif':
      return (
        startsWith(bytes, Buffer.from('ftyp'), 4) &&
        /(?:avif|avis)/.test(bytes.subarray(8, 40).toString('ascii'))
      )
    case 'image/bmp':
      return startsWith(bytes, Buffer.from('BM'))
    case 'image/x-icon':
      return startsWith(bytes, Buffer.from([0x00, 0x00, 0x01, 0x00]))
    case 'application/pdf':
      return startsWith(bytes, PDF_MAGIC)
    case 'image/svg+xml':
      return looksLikeSvg(bytes)
    case 'text/csv':
    case 'text/plain':
    case 'text/markdown':
    case 'application/json':
      return isProbablyText(bytes)
    default:
      return false
  }
}

function looksLikeSvg(bytes: Buffer): boolean {
  if (!isProbablyText(bytes)) {
    return false
  }

  const head = bytes.subarray(0, 4096).toString('utf8').trimStart().toLowerCase()
  return /^<svg(?:\s|>)/.test(head) || (head.startsWith('<?xml') && /<svg(?:\s|>)/.test(head))
}

function isProbablyText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 4096)

  for (const byte of sample) {
    // Reject NUL and most C0 control chars except tab/newline/carriage return.
    if (byte === 0) {
      return false
    }

    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) {
      return false
    }
  }

  return true
}

export type ValidateAssetInput = {
  filename: string
  mediaType: string
  data: string
}

/**
 * Validate an upload end-to-end: decode, enforce size, media-type allowlist,
 * extension/filename safety, and byte-content sniffing. Returns the decoded
 * bytes and a checksum on success.
 */
export function validateAssetUpload(input: ValidateAssetInput): AssetValidationResult {
  const rawFilename = input.filename ?? ''

  if (isSuspiciousAssetFilename(rawFilename)) {
    return {
      ok: false,
      error: { code: 'suspicious_filename', message: 'The filename is not allowed.' },
    }
  }

  const filename = sanitizeAssetFilename(rawFilename)

  if (!filename) {
    return {
      ok: false,
      error: { code: 'suspicious_filename', message: 'The filename is not allowed.' },
    }
  }

  const mediaType = resolveAssetMediaType(filename, input.mediaType)

  if (!isAllowedAssetMediaType(mediaType)) {
    return {
      ok: false,
      error: {
        code: 'unsupported_media_type',
        message: `Unsupported file type: ${input.mediaType || 'unknown'}. Allowed types: ${Object.keys(
          ALLOWED_ASSET_MEDIA_TYPES,
        ).join(', ')}.`,
      },
    }
  }

  if (!extensionMatchesMediaType(filename, mediaType)) {
    return {
      ok: false,
      error: {
        code: 'extension_mismatch',
        message: `The file extension does not match the ${mediaType} content type.`,
      },
    }
  }

  const bytes = decodeAssetPayload(input.data)

  if (!bytes) {
    return {
      ok: false,
      error: { code: 'invalid_payload', message: 'The file payload could not be decoded.' },
    }
  }

  if (bytes.length === 0) {
    return { ok: false, error: { code: 'empty', message: 'The file is empty.' } }
  }

  if (isAssetUploadTooLarge(bytes.length)) {
    return {
      ok: false,
      error: {
        code: 'too_large',
        message: `The file exceeds the ${MAX_ASSET_UPLOAD_BYTES} byte limit.`,
      },
    }
  }

  if (!sniffMatchesMediaType(bytes, mediaType)) {
    return {
      ok: false,
      error: {
        code: 'content_mismatch',
        message: `The file content does not look like ${mediaType}.`,
      },
    }
  }

  return {
    ok: true,
    bytes,
    mediaType,
    filename,
    byteSize: bytes.length,
    checksum: computeChecksum(bytes),
  }
}
