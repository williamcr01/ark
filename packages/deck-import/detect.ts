import {
  PPTX_ENCRYPTED_MESSAGE,
  PPTX_INVALID_MESSAGE,
  PPTX_LEGACY_MESSAGE,
  PptxImportError,
} from './errors.ts'

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]
const ZIP_MAGIC = [0x50, 0x4b]

function startsWith(bytes: Uint8Array, magic: readonly number[]) {
  return magic.every((value, index) => bytes[index] === value)
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array) {
  if (needle.length === 0 || needle.length > haystack.length) return -1
  outer: for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer
    }
    return index
  }
  return -1
}

function containsUtf16le(bytes: Uint8Array, ascii: string) {
  return indexOfBytes(bytes, Buffer.from(ascii, 'utf16le')) !== -1
}

function containsAscii(bytes: Uint8Array, ascii: string) {
  return indexOfBytes(bytes, Buffer.from(ascii, 'utf8')) !== -1
}

export function filenameExtension(filename: string | null | undefined) {
  const lower = filename?.trim().toLowerCase() ?? ''
  if (lower.endsWith('.pptx')) return 'pptx'
  if (lower.endsWith('.ppt')) return 'ppt'
  return null
}

export function assertPptxBytes(bytes: Uint8Array, filename?: string | null) {
  const extension = filenameExtension(filename)

  if (extension === 'ppt') {
    throw new PptxImportError(PPTX_LEGACY_MESSAGE, 'pptx_legacy')
  }

  if (bytes.byteLength < 8) {
    throw new PptxImportError(PPTX_INVALID_MESSAGE, 'pptx_invalid')
  }

  if (startsWith(bytes, OLE_MAGIC)) {
    if (containsUtf16le(bytes, 'PowerPoint Document')) {
      throw new PptxImportError(PPTX_LEGACY_MESSAGE, 'pptx_legacy')
    }
    throw new PptxImportError(PPTX_ENCRYPTED_MESSAGE, 'pptx_encrypted')
  }

  if (!startsWith(bytes, ZIP_MAGIC)) {
    throw new PptxImportError(PPTX_INVALID_MESSAGE, 'pptx_invalid')
  }

  if (
    containsAscii(bytes, 'EncryptedPackage') &&
    (containsAscii(bytes, 'EncryptionInfo') || containsUtf16le(bytes, 'EncryptionInfo'))
  ) {
    throw new PptxImportError(PPTX_ENCRYPTED_MESSAGE, 'pptx_encrypted')
  }
}
