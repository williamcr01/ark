import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { healthResponseSchema, modelsResponseSchema } from '../health.ts'
import { jsonApiError } from './shared.ts'

export function registerHealthPaths(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: 'get',
    path: '/api/health',
    summary: 'Health check',
    responses: {
      200: {
        description: 'Service health and provider configuration',
        content: { 'application/json': { schema: healthResponseSchema } },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/models',
    summary: 'List available language models',
    responses: {
      200: {
        description: 'Configured models',
        content: { 'application/json': { schema: modelsResponseSchema } },
      },
      500: jsonApiError,
    },
  })
}
