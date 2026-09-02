import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import {
  createPreviewSessionRequestSchema,
  getPreviewSessionResponseSchema,
  previewSessionResponseSchema,
} from '../preview.ts'
import { simpleErrorResponseSchema } from '../common.ts'
import { jsonError, previewTokenParams } from './shared.ts'

export function registerPreviewPaths(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: 'post',
    path: '/api/preview-sessions',
    summary: 'Create a sandbox preview session',
    request: {
      body: { content: { 'application/json': { schema: createPreviewSessionRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Short-lived render token',
        content: { 'application/json': { schema: previewSessionResponseSchema } },
      },
      400: jsonError,
      413: {
        description: 'Request body or asset-expanded preview exceeds its size limit',
        content: {
          'application/json': {
            schema: simpleErrorResponseSchema,
          },
        },
      },
      500: jsonError,
      503: jsonError,
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/preview-sessions/{token}',
    summary: 'Resolve a preview session (sandbox host)',
    request: { params: previewTokenParams },
    responses: {
      200: {
        description: 'Session HTML payload',
        content: { 'application/json': { schema: getPreviewSessionResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
    },
  })
}
