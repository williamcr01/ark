import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import {
  deckThumbnailImageParamsSchema,
  deckThumbnailImageQuerySchema,
  deckThumbnailsQuerySchema,
  deckThumbnailsResponseSchema,
} from '../thumbnails.ts'
import { deckIdParam, jsonError } from './shared.ts'

export function registerThumbnailPaths(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: 'get',
    path: '/api/decks/{id}/thumbnails',
    summary: 'Get sandbox-rendered slide thumbnails for a document revision',
    description:
      'Returns cached per-slide PNG URLs when ready. Missing thumbnails enqueue an async render and return `pending`. When the renderer is unavailable, returns `disabled` and clients fall back to script-stripped srcDoc thumbnails.',
    request: {
      params: deckIdParam,
      query: deckThumbnailsQuerySchema,
    },
    responses: {
      200: {
        description: 'Thumbnail status and slide URLs',
        content: { 'application/json': { schema: deckThumbnailsResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/decks/{id}/thumbnails/{documentRevision}/{slideFile}',
    summary: 'Serve a cached slide thumbnail PNG',
    request: {
      params: deckThumbnailImageParamsSchema,
      query: deckThumbnailImageQuerySchema,
    },
    responses: {
      200: {
        description: 'PNG image bytes with long-lived immutable cache headers',
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })
}
