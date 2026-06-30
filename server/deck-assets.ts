import type { Request, Response } from 'express'

import {
  buildDeckAssetProxyUrl,
  isAllowedAssetHost,
  parseDeckAssetAllowlist,
} from '../shared/deck-network.ts'

const MAX_ASSET_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 10_000

const ALLOWED_MIME_PREFIXES = ['image/', 'font/', 'text/css', 'application/font']

type CachedAsset = {
  body: Buffer
  contentType: string
  fetchedAt: number
}

const assetCache = new Map<string, CachedAsset>()

function getAllowlist() {
  return parseDeckAssetAllowlist(process.env.ARK_DECK_ASSET_ALLOWLIST)
}

function isAllowedMimeType(contentType: string) {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? ''

  return ALLOWED_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

async function fetchRemoteAsset(url: URL) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'image/*,text/css,font/*,application/font-*',
      },
    })

    if (!response.ok) {
      throw new Error(`Upstream responded with ${response.status}.`)
    }

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream'

    if (!isAllowedMimeType(contentType)) {
      throw new Error(`Blocked asset type: ${contentType}.`)
    }

    const body = Buffer.from(await response.arrayBuffer())

    if (body.byteLength > MAX_ASSET_BYTES) {
      throw new Error(`Asset exceeds ${MAX_ASSET_BYTES} bytes.`)
    }

    return { body, contentType }
  } finally {
    clearTimeout(timeout)
  }
}

export async function handleDeckAssetRequest(request: Request, response: Response) {
  const rawUrl = typeof request.query.url === 'string' ? request.query.url.trim() : ''

  if (!rawUrl) {
    response.status(400).json({ error: 'url query parameter is required.' })
    return
  }

  let parsedUrl: URL

  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    response.status(400).json({ error: 'url must be a valid absolute http(s) URL.' })
    return
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    response.status(400).json({ error: 'Only http(s) asset URLs are supported.' })
    return
  }

  const allowlist = getAllowlist()

  if (!isAllowedAssetHost(parsedUrl, allowlist)) {
    response.status(403).json({
      error: 'External assets are blocked. Configure ARK_DECK_ASSET_ALLOWLIST to proxy approved hosts.',
      proxyUrl: buildDeckAssetProxyUrl(parsedUrl.toString()),
    })
    return
  }

  const cacheKey = parsedUrl.toString()
  const cached = assetCache.get(cacheKey)

  if (cached) {
    response.setHeader('Content-Type', cached.contentType)
    response.setHeader('Cache-Control', 'public, max-age=3600')
    response.send(cached.body)
    return
  }

  try {
    const asset = await fetchRemoteAsset(parsedUrl)

    assetCache.set(cacheKey, {
      ...asset,
      fetchedAt: Date.now(),
    })

    response.setHeader('Content-Type', asset.contentType)
    response.setHeader('Cache-Control', 'public, max-age=3600')
    response.send(asset.body)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Asset could not be fetched.'
    response.status(502).json({ error: message })
  }
}
