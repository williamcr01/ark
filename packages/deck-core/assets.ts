/**
 * Shared asset definitions used by both client and server.
 *
 * Assets are user-provided files (images, screenshots, CSV/text, PDFs) that Ark
 * stores as first-class, deck-scoped resources. They are always served through
 * Ark-owned URLs (`/api/decks/:deckId/assets/:id`) — never arbitrary external URLs — so deck
 * preview and export never trigger uncontrolled network requests.
 */

export type AssetCategory = 'image' | 'text' | 'pdf' | 'other'

/** Where an asset originated. */
export type AssetSource = 'upload' | 'screenshot' | 'proxy'

export const ASSET_SOURCES: readonly AssetSource[] = ['upload', 'screenshot', 'proxy']

/** Hard upper bound for a single uploaded asset. */
export const MAX_ASSET_UPLOAD_BYTES = 50 * 1024 * 1024

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
  'image/png': { extensions: ['.png', '.apng'], category: 'image' },
  'image/apng': { extensions: ['.apng'], category: 'image' },
  'image/jpeg': {
    extensions: ['.jpg', '.jpeg', '.jfif', '.pjpeg', '.pjp'],
    category: 'image',
  },
  'image/gif': { extensions: ['.gif'], category: 'image' },
  'image/webp': { extensions: ['.webp'], category: 'image' },
  'image/avif': { extensions: ['.avif'], category: 'image' },
  'image/svg+xml': { extensions: ['.svg'], category: 'image' },
  'image/bmp': { extensions: ['.bmp'], category: 'image' },
  'image/x-icon': { extensions: ['.ico'], category: 'image' },
  'text/csv': { extensions: ['.csv'], category: 'text' },
  'text/plain': { extensions: ['.txt', '.text'], category: 'text' },
  'text/markdown': { extensions: ['.md', '.markdown'], category: 'text' },
  'application/json': { extensions: ['.json'], category: 'text' },
  'application/pdf': { extensions: ['.pdf'], category: 'pdf' },
}

/** `accept` attribute value for asset file inputs. */
export const ASSET_UPLOAD_ACCEPT = Object.keys(ALLOWED_ASSET_MEDIA_TYPES).join(',')

const ASSET_MEDIA_TYPE_ALIASES: Record<string, string> = {
  'image/pjpeg': 'image/jpeg',
  'image/x-ms-bmp': 'image/bmp',
  'image/vnd.microsoft.icon': 'image/x-icon',
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidAssetId(id: string) {
  return UUID_PATTERN.test(id)
}

export function normalizeAssetMediaType(mediaType: string) {
  const normalized = mediaType.split(';')[0]?.trim().toLowerCase() ?? ''
  return ASSET_MEDIA_TYPE_ALIASES[normalized] ?? normalized
}

/** Resolve an allowed canonical media type, falling back to a unique filename extension. */
export function resolveAssetMediaType(filename: string, mediaType: string) {
  const normalized = normalizeAssetMediaType(mediaType)
  const lower = filename.toLowerCase()

  if (
    lower.endsWith('.apng') &&
    (!normalized || normalized === 'image/png' || normalized === 'application/octet-stream')
  ) {
    return 'image/apng'
  }

  if (normalized in ALLOWED_ASSET_MEDIA_TYPES) {
    return normalized
  }

  return (
    Object.entries(ALLOWED_ASSET_MEDIA_TYPES).find(([, spec]) =>
      spec.extensions.some((extension) => lower.endsWith(extension)),
    )?.[0] ?? ''
  )
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

/** Build the stable, deck-scoped URL used to fetch an asset's bytes. */
export function buildAssetUrl(deckId: string, id: string) {
  return `/api/decks/${deckId}/assets/${id}`
}

/** Build the lightweight reference used until a new deck owns the asset. */
export function buildTemporaryAssetUrl(id: string) {
  return `/api/assets/${id}`
}

const DECK_SCOPED_ASSET_URL_PATTERN =
  /^\/api\/decks\/([0-9a-f-]{36})\/assets\/([0-9a-f-]{36})(?:$|[/?#])/i
const TEMPORARY_ASSET_URL_PATTERN = /^\/api\/assets\/([0-9a-f-]{36})(?:$|[/?#])/i

/** Extract an asset id from an Ark-owned asset URL, if present. */
export function parseAssetIdFromUrl(url: string): string | null {
  const trimmed = url.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
    return null
  }
  const deckScoped = DECK_SCOPED_ASSET_URL_PATTERN.exec(trimmed)
  const id = deckScoped?.[2] ?? TEMPORARY_ASSET_URL_PATTERN.exec(trimmed)?.[1]

  return id && isValidAssetId(id) ? id : null
}

/** Extract deck and asset ids from a deck-scoped Ark asset URL. */
export function parseDeckAssetFromUrl(url: string): { deckId: string; assetId: string } | null {
  const trimmed = url.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
    return null
  }
  const match = DECK_SCOPED_ASSET_URL_PATTERN.exec(trimmed)
  const deckId = match?.[1]
  const assetId = match?.[2]

  if (!deckId || !assetId || !isValidAssetId(assetId)) {
    return null
  }

  return { deckId, assetId }
}

/** True when a URL points at an Ark-owned asset (safe for preview/export). */
export function isArkAssetUrl(url: string) {
  return parseAssetIdFromUrl(url) !== null
}

const ARK_DECK_ASSET_REFERENCE_PATTERN =
  /(^|[("'=\s,])((?:\/api\/decks\/)[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/gi

/** Absolutize only validated deck-scoped Ark asset paths embedded in HTML/CSS values. */
export function absolutizeArkAssetReferences(
  value: string,
  assetOrigin: string | null | undefined,
) {
  if (!assetOrigin?.trim()) return value

  let origin: string
  try {
    const parsed = new URL(assetOrigin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return value
    origin = parsed.origin
  } catch {
    return value
  }

  return value.replace(
    ARK_DECK_ASSET_REFERENCE_PATTERN,
    (_match, prefix: string, path: string) => `${prefix}${origin}${path}`,
  )
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
