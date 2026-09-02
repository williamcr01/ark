import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { generationJobResponseSchema, startGenerationJobRequestSchema } from '../generation-jobs.ts'
import { generationJobParams, jsonApiError, jsonError } from './shared.ts'

export function registerGenerationPaths(registry: OpenAPIRegistry) {
  registry.registerPath({
    method: 'post',
    path: '/api/generation-jobs',
    summary: 'Start an async generation job',
    description:
      'Enqueue deck generation or editing. Optional `assetIds` attach assets owned by `deckId`. Poll `GET /api/generation-jobs/{id}` until the job reaches a terminal status.',
    request: {
      body: { content: { 'application/json': { schema: startGenerationJobRequestSchema } } },
    },
    responses: {
      202: {
        description: 'Job accepted (wire shape omits request messages and `assetIds`)',
        content: { 'application/json': { schema: generationJobResponseSchema } },
      },
      400: jsonApiError,
      503: jsonApiError,
      500: jsonApiError,
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/generation-jobs/{id}',
    summary: 'Get generation job status',
    request: { params: generationJobParams },
    responses: {
      200: {
        description: 'Job snapshot',
        content: { 'application/json': { schema: generationJobResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/generation-jobs/{id}/cancel',
    summary: 'Cancel a generation job',
    request: { params: generationJobParams },
    responses: {
      200: {
        description: 'Updated job (may still be canceling)',
        content: { 'application/json': { schema: generationJobResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/generation-jobs/{id}/retry',
    summary: 'Retry a failed or canceled job',
    request: { params: generationJobParams },
    responses: {
      202: {
        description: 'Replacement job enqueued',
        content: { 'application/json': { schema: generationJobResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      503: jsonApiError,
      500: jsonError,
    },
  })
}
