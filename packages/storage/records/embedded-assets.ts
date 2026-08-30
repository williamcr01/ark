import { randomUUID } from 'node:crypto'

import {
  buildArkAssetUrl,
  getAssetCategory,
  MAX_ASSET_UPLOAD_BYTES,
  type AssetSource,
} from '@ark/deck/document/assets.ts'

export type EmbeddedAsset = {
  id: string
  filename: string
  mediaType: string
  category: ReturnType<typeof getAssetCategory>
  source: AssetSource
  bytes: Buffer
}

const DATA_URL_PATTERN =
  /data:([a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*)(;base64)?,([^\s"'<>)]*)/gi

// This intentionally rewrites the whole document, including script text. Keep
// it paired with resolveArkAssetUrls' whole-document replacement if scoping is narrowed later.

function extension(mediaType: string) {
  return (
    {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/avif': 'avif',
      'image/svg+xml': 'svg',
    }[mediaType] ?? 'bin'
  )
}

export function extractEmbeddedAssets(html: string) {
  const assets: EmbeddedAsset[] = []
  const rewritten = html.replace(
    DATA_URL_PATTERN,
    (match, rawMediaType: string, base64: string | undefined, payload: string) => {
      let bytes: Buffer
      try {
        bytes = base64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload))
      } catch {
        return match
      }
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_UPLOAD_BYTES) return match
      const mediaType = rawMediaType.toLowerCase()
      const id = randomUUID()
      assets.push({
        id,
        filename: `embedded-${id}.${extension(mediaType)}`,
        mediaType,
        category: getAssetCategory(mediaType),
        source: 'upload',
        bytes,
      })
      return buildArkAssetUrl(id)
    },
  )
  return { html: rewritten, assets }
}
