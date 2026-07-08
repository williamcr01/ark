import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'

import type { NextFunction, Request, Response } from 'express'

import {
  getApprovedRuntime,
  getRuntimeRegistrySummary,
  lookupRuntimeAsset,
  type RuntimeAssetRef,
} from '@ark/runtime-registry/deck-runtime-registry.ts'

import { REPO_ROOT } from './repo-root.ts'

const ROOT = REPO_ROOT
const RUNTIMES_DIR = path.join(ROOT, 'runtimes')

const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.eot': 'application/vnd.ms-fontobject',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function getContentType(assetPath: string) {
  const extension = path.extname(assetPath).toLowerCase()
  return MIME_TYPES[extension] ?? 'application/octet-stream'
}

function decodePathParam(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function resolveRuntimeAssetFile(ref: RuntimeAssetRef) {
  const baseDir = path.join(RUNTIMES_DIR, ref.runtimeId, ref.version)
  const resolved = path.resolve(baseDir, ref.assetPath)

  if (!resolved.startsWith(`${baseDir}${path.sep}`)) {
    return null
  }

  if (!existsSync(resolved)) {
    return null
  }

  return resolved
}

export function handleRuntimeRegistryRequest(_request: Request, response: Response) {
  response.json({
    schemaVersion: 1,
    runtimes: getRuntimeRegistrySummary(),
  })
}

export function handleRuntimeAssetRequest(request: Request, response: Response) {
  const runtimeIdParam =
    typeof request.params.runtimeId === 'string' ? request.params.runtimeId : ''
  const versionParam = typeof request.params.version === 'string' ? request.params.version : ''
  const assetPathParam =
    typeof request.params.assetPath === 'string' ? request.params.assetPath : ''
  const runtimeId = decodePathParam(runtimeIdParam)
  const version = decodePathParam(versionParam)
  const assetPath = decodePathParam(assetPathParam)

  if (!runtimeId || !version || !assetPath) {
    response.status(400).json({ error: 'runtimeId, version, and asset path are required.' })
    return
  }

  const ref: RuntimeAssetRef = { runtimeId, version, assetPath }
  const lookup = lookupRuntimeAsset(ref)

  if (!lookup) {
    response.status(404).json({ error: 'Runtime asset is not in the approved registry.' })
    return
  }

  const runtime = getApprovedRuntime(ref.runtimeId, ref.version)

  if (!runtime) {
    response.status(404).json({ error: 'Runtime version is not approved.' })
    return
  }

  const filePath = resolveRuntimeAssetFile(ref)

  if (!filePath) {
    response.status(404).json({ error: 'Runtime asset file is missing on disk.' })
    return
  }

  response.setHeader('Content-Type', getContentType(ref.assetPath))
  response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Checksum-Sha256', lookup.asset.sha256)
  createReadStream(filePath).pipe(response)
}

const RUNTIME_ASSET_PATH_PATTERN = /^\/api\/runtimes\/([^/]+)\/([^/]+)\/(.+)$/

export function handleRuntimeRoutes(request: Request, response: Response, next: NextFunction) {
  if (request.method !== 'GET') {
    next()
    return
  }

  const pathname = request.path

  if (pathname === '/api/runtimes') {
    handleRuntimeRegistryRequest(request, response)
    return
  }

  const match = pathname.match(RUNTIME_ASSET_PATH_PATTERN)

  if (!match) {
    next()
    return
  }

  request.params = {
    ...request.params,
    runtimeId: match[1] ?? '',
    version: match[2] ?? '',
    assetPath: match[3] ?? '',
  }

  handleRuntimeAssetRequest(request, response)
}
