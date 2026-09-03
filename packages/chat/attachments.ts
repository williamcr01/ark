import { isValidAssetId, parseAssetIdFromUrl } from '@ark/deck/document/assets.ts'

/**
 * Serializable file attachment sent with a user message.
 *
 * Two shapes are supported:
 * - Inline data URL (`url` starts with `data:`) — bytes travel with the message.
 * - Ark asset reference (`assetId` set, `url` is a deck-scoped `/api/decks/:deckId/assets/:id`
 *   URL) — the persisted message stays lightweight and the server resolves the
 *   bytes from asset storage when needed for generation.
 */
export type ChatAttachment = {
  type: 'file'
  mediaType: string
  filename?: string
  url: string
  assetId?: string
}

export const MAX_CHAT_ATTACHMENT_BYTES = 50 * 1024 * 1024
export const MAX_CHAT_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024

/** Max characters of decoded text inlined into a model TextPart per attachment. */
export const MAX_INLINE_TEXT_ATTACHMENT_CHARS = 256 * 1024

const estimateDataUrlBytes = (url: string) => {
  const commaIndex = url.indexOf(',')
  if (commaIndex === -1) {
    return url.length
  }

  const payload = url.slice(commaIndex + 1)
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

export const parseChatAttachments = (
  input: unknown,
  messageIndex: number,
): { ok: true; attachments: ChatAttachment[] } | { ok: false; error: string } => {
  if (input === undefined) {
    return { ok: true, attachments: [] }
  }

  if (!Array.isArray(input)) {
    return { ok: false, error: `messages[${messageIndex}].attachments must be an array.` }
  }

  const attachments: ChatAttachment[] = []
  let totalInlineBytes = 0

  for (const [attachmentIndex, item] of input.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}] must be an object.`,
      }
    }

    const type = (item as { type?: unknown }).type
    if (type !== 'file') {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].type must be "file".`,
      }
    }

    const mediaType = (item as { mediaType?: unknown }).mediaType
    if (typeof mediaType !== 'string' || mediaType.trim().length === 0) {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].mediaType must be a string.`,
      }
    }

    const url = (item as { url?: unknown }).url
    const rawAssetId = (item as { assetId?: unknown }).assetId

    if (
      rawAssetId !== undefined &&
      (typeof rawAssetId !== 'string' || !isValidAssetId(rawAssetId))
    ) {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].assetId must be a valid asset id.`,
      }
    }

    if (typeof url !== 'string') {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].url must be a string.`,
      }
    }

    const assetId =
      typeof rawAssetId === 'string' ? rawAssetId : (parseAssetIdFromUrl(url) ?? undefined)
    const isDataUrl = url.startsWith('data:')

    // Accept either an inline data URL or an Ark-owned asset reference. External
    // http(s) URLs are never allowed to keep preview/export network-isolated.
    if (!isDataUrl && !assetId) {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].url must be a data URL or Ark asset reference.`,
      }
    }

    const filename = (item as { filename?: unknown }).filename
    if (filename !== undefined && typeof filename !== 'string') {
      return {
        ok: false,
        error: `messages[${messageIndex}].attachments[${attachmentIndex}].filename must be a string.`,
      }
    }

    if (isDataUrl) {
      const estimatedBytes = estimateDataUrlBytes(url)
      if (estimatedBytes > MAX_CHAT_ATTACHMENT_BYTES) {
        return {
          ok: false,
          error: `messages[${messageIndex}].attachments[${attachmentIndex}] exceeds the ${MAX_CHAT_ATTACHMENT_BYTES} byte limit.`,
        }
      }
      totalInlineBytes += estimatedBytes
      if (totalInlineBytes > MAX_CHAT_ATTACHMENT_TOTAL_BYTES) {
        return {
          ok: false,
          error: `messages[${messageIndex}].attachments exceed the ${MAX_CHAT_ATTACHMENT_TOTAL_BYTES} byte combined inline limit.`,
        }
      }
    }

    attachments.push({
      type: 'file',
      mediaType: mediaType.trim(),
      url,
      ...(assetId ? { assetId } : {}),
      ...(typeof filename === 'string' && filename.trim().length > 0
        ? { filename: filename.trim() }
        : {}),
    })
  }

  return { ok: true, attachments }
}

/** Media types that models should receive as text, not provider file parts. */
export function isReadableTextMediaType(mediaType: string) {
  const normalized = mediaType.split(';')[0]?.trim().toLowerCase() ?? ''
  return normalized.startsWith('text/') || normalized === 'application/json'
}

function decodeBase64ToUtf8(base64: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64').toString('utf8')
  }

  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Decode a `data:` URL payload to UTF-8 text. Returns null when the URL is invalid. */
export function decodeDataUrlText(dataUrl: string): string | null {
  if (!dataUrl.startsWith('data:')) {
    return null
  }

  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex === -1) {
    return null
  }

  const meta = dataUrl.slice(5, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  const isBase64 = meta.split(';').some((parameter) => parameter.trim().toLowerCase() === 'base64')

  try {
    if (isBase64) {
      return decodeBase64ToUtf8(payload)
    }

    return decodeURIComponent(payload)
  } catch {
    return null
  }
}

export function toChatAttachments(
  files: Array<{ mediaType: string; filename?: string; url: string; assetId?: string }>,
): ChatAttachment[] {
  return files.map((file) => ({
    type: 'file',
    mediaType: file.mediaType,
    url: file.url,
    ...(file.assetId ? { assetId: file.assetId } : {}),
    ...(file.filename ? { filename: file.filename } : {}),
  }))
}

/** Collect the unique Ark asset ids referenced by a set of attachments. */
export function collectAssetIds(attachments: ChatAttachment[] | undefined): string[] {
  if (!attachments?.length) {
    return []
  }

  const ids = new Set<string>()

  for (const attachment of attachments) {
    const id = attachment.assetId ?? parseAssetIdFromUrl(attachment.url)
    if (id) {
      ids.add(id)
    }
  }

  return [...ids]
}
