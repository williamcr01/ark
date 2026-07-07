import type { Request, Response } from 'express'

import {
  buildDeckAssetProxyUrl,
  isAllowedAssetHost,
  parseDeckAssetAllowlist,
} from '@ark/deck-core/deck-network.ts'
import { categorizeAssetProxyFailure } from './observability/provider-errors.ts'
import { getRequestLogger } from './observability/middleware.ts'

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
  const logger = getRequestLogger(request)
  const rawUrl = typeof request.query.url === 'string' ? request.query.url.trim() : ''

  if (!rawUrl) {
    logger.warn('asset_proxy.rejected', {
      errorCategory: 'missing_url',
      statusCode: 400,
    })
    response.status(400).json({ error: 'url query parameter is required.' })
    return
  }

  let parsedUrl: URL

  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    logger.warn('asset_proxy.rejected', {
      errorCategory: 'invalid_url',
      statusCode: 400,
    })
    response.status(400).json({ error: 'url must be a valid absolute http(s) URL.' })
    return
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    logger.warn('asset_proxy.rejected', {
      errorCategory: 'invalid_url',
      statusCode: 400,
    })
    response.status(400).json({ error: 'Only http(s) asset URLs are supported.' })
    return
  }

  const allowlist = getAllowlist()

  if (!isAllowedAssetHost(parsedUrl, allowlist)) {
    logger.warn('asset_proxy.blocked', {
      errorCategory: 'allowlist_blocked',
      host: parsedUrl.hostname,
      statusCode: 403,
    })
    response.status(403).json({
      error:
        'External assets are blocked. Configure ARK_DECK_ASSET_ALLOWLIST to proxy approved hosts.',
      proxyUrl: buildDeckAssetProxyUrl(parsedUrl.toString()),
    })
    return
  }

  const cacheKey = parsedUrl.toString()
  const cached = assetCache.get(cacheKey)

  if (cached) {
    logger.info('asset_proxy.cache_hit', {
      host: parsedUrl.hostname,
      statusCode: 200,
    })
    response.setHeader('Content-Type', cached.contentType)
    response.setHeader('Cache-Control', 'public, max-age=3600')
    response.send(cached.body)
    return
  }

  try {
    const fetchStartedAt = performance.now()
    const asset = await fetchRemoteAsset(parsedUrl)
    const durationMs = Math.round(performance.now() - fetchStartedAt)

    assetCache.set(cacheKey, {
      ...asset,
      fetchedAt: Date.now(),
    })

    logger.info('asset_proxy.fetched', {
      host: parsedUrl.hostname,
      durationMs,
      contentType: asset.contentType,
      byteLength: asset.body.byteLength,
      statusCode: 200,
    })

    response.setHeader('Content-Type', asset.contentType)
    response.setHeader('Cache-Control', 'public, max-age=3600')
    response.send(asset.body)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Asset could not be fetched.'
    const errorCategory = categorizeAssetProxyFailure(error)

    logger.warn('asset_proxy.failed', {
      host: parsedUrl.hostname,
      errorCategory,
      message,
      statusCode: 502,
    })

    response.status(502).json({ error: message })
  }
}
