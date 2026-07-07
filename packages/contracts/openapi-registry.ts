/**
 * OpenAPI path registry for Ark's HTTP API.
 *
 * Schemas are sourced from `packages/contracts/*.ts` Zod contracts. Run
 * `pnpm openapi:generate` to emit `openapi/ark.openapi.json`.
 */
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import {
  apiErrorPayloadSchema,
  deckIdSchema,
  generationJobIdSchema,
  simpleErrorResponseSchema,
} from './common.ts'
import {
  appendChatMessageRequestSchema,
  appendChatMessageResponseSchema,
  deckChatQuerySchema,
  deckChatResponseSchema,
} from './chat.ts'
import {
  assetListResponseSchema,
  uploadAssetRequestSchema,
  uploadAssetResponseSchema,
} from './assets.ts'
import { healthResponseSchema, modelsResponseSchema } from './health.ts'
import {
  createDeckRequestSchema,
  createDeckResponseSchema,
  deckListResponseSchema,
  deckPatchErrorResponseSchema,
  deckPatchRequestSchema,
  deckPatchResponseSchema,
  deckResponseSchema,
  deckRollbackResponseSchema,
  deckValidationErrorResponseSchema,
  deckVersionListResponseSchema,
  deckVersionResponseSchema,
  renameDeckRequestSchema,
  rollbackDeckRequestSchema,
  updateDeckRequestSchema,
} from './decks.ts'
import { generationJobResponseSchema, startGenerationJobRequestSchema } from './generation-jobs.ts'
import {
  createPreviewSessionRequestSchema,
  getPreviewSessionResponseSchema,
  previewSessionResponseSchema,
} from './preview.ts'
import { runtimeErrorInputSchema, runtimeErrorResponseSchema } from './runtime-errors.ts'

extendZodWithOpenApi(z)

const deckIdParam = z.object({ id: deckIdSchema })
const deckVersionParams = z.object({ id: deckIdSchema, versionId: deckIdSchema })
const deckAssetParams = z.object({ id: deckIdSchema, assetId: z.string().min(1) })
const generationJobParams = z.object({ id: generationJobIdSchema })
const previewTokenParams = z.object({ token: z.string().min(1) })

const jsonError = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: simpleErrorResponseSchema,
    },
  },
}

const jsonApiError = {
  description: 'API error with code',
  content: {
    'application/json': {
      schema: apiErrorPayloadSchema,
    },
  },
}

export function createArkOpenApiRegistry() {
  const registry = new OpenAPIRegistry()

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

  registry.registerPath({
    method: 'get',
    path: '/api/decks',
    summary: 'List decks',
    responses: {
      200: {
        description: 'Deck summaries',
        content: { 'application/json': { schema: deckListResponseSchema } },
      },
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/decks',
    summary: 'Create a deck',
    request: {
      body: { content: { 'application/json': { schema: createDeckRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Created deck',
        content: { 'application/json': { schema: createDeckResponseSchema } },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: deckValidationErrorResponseSchema } },
      },
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/decks/{id}',
    summary: 'Get a deck',
    request: { params: deckIdParam },
    responses: {
      200: {
        description: 'Deck with HTML',
        content: { 'application/json': { schema: deckResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'put',
    path: '/api/decks/{id}',
    summary: 'Replace deck HTML',
    request: {
      params: deckIdParam,
      body: { content: { 'application/json': { schema: updateDeckRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Updated deck',
        content: { 'application/json': { schema: createDeckResponseSchema } },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: deckValidationErrorResponseSchema } },
      },
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/decks/{id}',
    summary: 'Rename a deck',
    request: {
      params: deckIdParam,
      body: { content: { 'application/json': { schema: renameDeckRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Renamed deck',
        content: { 'application/json': { schema: deckResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'delete',
    path: '/api/decks/{id}',
    summary: 'Delete a deck',
    request: { params: deckIdParam },
    responses: {
      204: { description: 'Deck deleted' },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/decks/{id}/patch',
    summary: 'Apply structured element patches',
    request: {
      params: deckIdParam,
      body: { content: { 'application/json': { schema: deckPatchRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Patched deck',
        content: { 'application/json': { schema: deckPatchResponseSchema } },
      },
      400: {
        description: 'Patch error',
        content: { 'application/json': { schema: deckPatchErrorResponseSchema } },
      },
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/decks/{id}/versions',
    summary: 'List deck versions',
    request: { params: deckIdParam },
    responses: {
      200: {
        description: 'Version summaries',
        content: { 'application/json': { schema: deckVersionListResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/decks/{id}/versions/{versionId}',
    summary: 'Get a deck version',
    request: { params: deckVersionParams },
    responses: {
      200: {
        description: 'Version detail with HTML',
        content: { 'application/json': { schema: deckVersionResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/decks/{id}/rollback',
    summary: 'Rollback to a prior version',
    request: {
      params: deckIdParam,
      body: { content: { 'application/json': { schema: rollbackDeckRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Rolled-back deck',
        content: { 'application/json': { schema: deckRollbackResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/decks/{id}/chat',
    summary: 'List chat messages for a deck',
    request: {
      params: deckIdParam,
      query: deckChatQuerySchema,
    },
    responses: {
      200: {
        description: 'Chat thread and messages',
        content: { 'application/json': { schema: deckChatResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/decks/{id}/chat/messages',
    summary: 'Append a chat message',
    request: {
      params: deckIdParam,
      body: { content: { 'application/json': { schema: appendChatMessageRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Persisted message',
        content: { 'application/json': { schema: appendChatMessageResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'delete',
    path: '/api/decks/{id}/chat',
    summary: 'Clear chat history for a deck',
    request: { params: deckIdParam },
    responses: {
      204: { description: 'Chat cleared' },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

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
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/generation-jobs',
    summary: 'Start an async generation job',
    description:
      'Enqueue deck generation or editing. Optional `assetIds` attach uploaded deck assets to the latest user turn; requires `deckId`. Poll `GET /api/generation-jobs/{id}` until the job reaches a terminal status.',
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
      500: jsonError,
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

  registry.registerPath({
    method: 'post',
    path: '/api/runtime-errors',
    summary: 'Report a deck runtime error',
    request: {
      body: { content: { 'application/json': { schema: runtimeErrorInputSchema } } },
    },
    responses: {
      201: {
        description: 'Recorded error',
        content: { 'application/json': { schema: runtimeErrorResponseSchema } },
      },
      400: jsonError,
    },
  })

  return registry
}

export function generateArkOpenApiDocument() {
  const registry = createArkOpenApiRegistry()
  const generator = new OpenApiGeneratorV3(registry.definitions)

  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Ark API',
      version: '1.0.0',
      description:
        'HTTP API for the Ark presentation builder. Zod schemas in `packages/contracts/` are the source of truth; this document is generated for cross-language clients and drift checks.',
    },
    servers: [{ url: 'http://localhost:8787', description: 'Local API (default PORT)' }],
  })
}
