/**
 * Shared asset definitions used by both client and server.
 *
 * Assets are user-provided files (images, screenshots, CSV/text, PDFs) that Ark
 * stores as first-class, deck-scoped resources. They are always served through
 * Ark-owned URLs (`/api/assets/:id`) — never arbitrary external URLs — so deck
 * preview and export never trigger uncontrolled network requests.
 */

export type AssetCategory = 'image' | 'text' | 'pdf' | 'other'

/** Where an asset originated. */
export type AssetSource = 'upload' | 'screenshot' | 'proxy'

export const ASSET_SOURCES: readonly AssetSource[] = ['upload', 'screenshot', 'proxy']

/** Hard upper bound for a single uploaded asset. */
export const MAX_ASSET_UPLOAD_BYTES = 10 * 1024 * 1024

export const MAX_ASSET_FILENAME_LENGTH = 200

type AssetMediaTypeSpec = {
  extensions: readonly string[]
  category: AssetCategory
}

/**
 * Allowlist of accepted upload media types mapped to their valid extensions and
 * high-level category. Anything outside this list is rejected on upload.
 */
export const ALLOWED_ASSET_MEDIA_TYPES: Record<string, AssetMediaTypeSpec> = {
  'image/png': { extensions: ['.png'], category: 'image' },
  'image/jpeg': { extensions: ['.jpg', '.jpeg'], category: 'image' },
  'image/gif': { extensions: ['.gif'], category: 'image' },
  'image/webp': { extensions: ['.webp'], category: 'image' },
  'image/svg+xml': { extensions: ['.svg'], category: 'image' },
  'text/csv': { extensions: ['.csv'], category: 'text' },
  'text/plain': { extensions: ['.txt', '.text'], category: 'text' },
  'text/markdown': { extensions: ['.md', '.markdown'], category: 'text' },
  'application/json': { extensions: ['.json'], category: 'text' },
  'application/pdf': { extensions: ['.pdf'], category: 'pdf' },
}

/** `accept` attribute value for asset file inputs. */
export const ASSET_UPLOAD_ACCEPT = Object.keys(ALLOWED_ASSET_MEDIA_TYPES).join(',')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidAssetId(id: string) {
  return UUID_PATTERN.test(id)
}

export function normalizeAssetMediaType(mediaType: string) {
  return mediaType.split(';')[0]?.trim().toLowerCase() ?? ''
}

export function isAllowedAssetMediaType(mediaType: string) {
  return normalizeAssetMediaType(mediaType) in ALLOWED_ASSET_MEDIA_TYPES
}

export function getAssetCategory(mediaType: string): AssetCategory {
  return ALLOWED_ASSET_MEDIA_TYPES[normalizeAssetMediaType(mediaType)]?.category ?? 'other'
}

export function getAssetExtensions(mediaType: string): readonly string[] {
  return ALLOWED_ASSET_MEDIA_TYPES[normalizeAssetMediaType(mediaType)]?.extensions ?? []
}

/** Build the stable, Ark-owned URL used to fetch an asset's bytes. */
export function buildAssetUrl(id: string) {
  return `/api/assets/${id}`
}

const ASSET_URL_PATTERN = /\/api\/assets\/([0-9a-f-]{36})(?:$|[/?#])/i

/** Extract an asset id from an Ark-owned asset URL, if present. */
export function parseAssetIdFromUrl(url: string): string | null {
  const match = ASSET_URL_PATTERN.exec(url.trim())
  const id = match?.[1]

  return id && isValidAssetId(id) ? id : null
}

/** True when a URL points at an Ark-owned asset (safe for preview/export). */
export function isArkAssetUrl(url: string) {
  return parseAssetIdFromUrl(url) !== null
}

// Intentionally matches control characters to strip them from filenames.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

/**
 * Reduce an arbitrary client filename to a safe basename: no path separators,
 * no control characters, bounded length. Never throws.
 */
export function sanitizeAssetFilename(filename: string): string {
  const withoutPath = filename.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = withoutPath
    .replace(CONTROL_CHARS, '')
    .replace(/[<>:"|?*]/g, '')
    .trim()
    .slice(0, MAX_ASSET_FILENAME_LENGTH)

  return cleaned
}

/**
 * A filename is suspicious if, after path stripping, it still looks like a
 * traversal attempt, is empty, or reduces to only dots.
 */
export function isSuspiciousAssetFilename(filename: string): boolean {
  if (filename.includes('\u0000')) {
    return true
  }

  const sanitized = sanitizeAssetFilename(filename)

  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return true
  }

  if (/[/\\]/.test(filename) || filename.includes('..')) {
    return true
  }

  return false
}

export type AssetMetadata = {
  id: string
  deckId: string | null
  chatMessageId: string | null
  filename: string
  mediaType: string
  category: AssetCategory
  byteSize: number
  checksum: string
  source: AssetSource
  storageKind: string
  url: string
  createdAt: string
}
