import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import {
  assetListResponseSchema,
  uploadAssetRequestSchema,
  uploadAssetResponseSchema,
} from '../assets.ts'
import { deckAssetParams, deckIdParam, jsonError } from './shared.ts'

export function registerAssetPaths(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: 'post',
    path: '/api/decks/{id}/assets',
    summary: 'Upload a deck asset',
    request: {
      params: deckIdParam,
      body: { content: { 'application/json': { schema: uploadAssetRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Uploaded asset metadata',
        content: { 'application/json': { schema: uploadAssetResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/decks/{id}/assets',
    summary: 'List deck assets',
    request: { params: deckIdParam },
    responses: {
      200: {
        description: 'Asset metadata list',
        content: { 'application/json': { schema: assetListResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/decks/{deckId}/assets/{assetId}',
    summary: 'Download a deck asset',
    request: { params: deckAssetParams },
    responses: {
      200: { description: 'Raw asset bytes' },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'delete',
    path: '/api/decks/{deckId}/assets/{assetId}',
    summary: 'Delete a deck asset',
    request: { params: deckAssetParams },
    responses: {
      204: { description: 'Asset deleted' },
      400: jsonError,
      404: jsonError,
      409: jsonError,
      500: jsonError,
    },
  })
}
