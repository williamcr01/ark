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
  chatThreadListResponseSchema,
  chatThreadResponseSchema,
  createChatThreadRequestSchema,
  deckChatQuerySchema,
  deckChatResponseSchema,
  updateChatThreadRequestSchema,
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
  deckValidationErrorResponseSchema,
  duplicateWorkspaceRequestSchema,
  importPptxRequestSchema,
  importPptxResponseSchema,
  renameDeckRequestSchema,
  restoreDocumentHistoryRequestSchema,
  restoreDocumentHistoryResponseSchema,
  documentHistoryListResponseSchema,
  deckConflictErrorResponseSchema,
  updateDeckRequestSchema,
  workspacePathRequestSchema,
} from './decks.ts'
import { generationJobResponseSchema, startGenerationJobRequestSchema } from './generation-jobs.ts'
import {
  createPreviewSessionRequestSchema,
  getPreviewSessionResponseSchema,
  previewSessionResponseSchema,
} from './preview.ts'
import {
  deckThumbnailImageParamsSchema,
  deckThumbnailImageQuerySchema,
  deckThumbnailsQuerySchema,
  deckThumbnailsResponseSchema,
} from './thumbnails.ts'
import {
  deckAssetProxyBlockedResponseSchema,
  deckAssetProxyQuerySchema,
} from './deck-asset-proxy.ts'
import { runtimeErrorInputSchema, runtimeErrorResponseSchema } from './runtime-errors.ts'
import { runtimeAssetParamsSchema, runtimeRegistryResponseSchema } from './runtimes.ts'
import { themeProposalRequestObjectSchema } from './mcp.ts'

extendZodWithOpenApi(z)

const deckIdParam = z.object({ id: deckIdSchema })
const deckAssetParams = z.object({ id: deckIdSchema, assetId: z.string().min(1) })
const deckThreadParams = z.object({ id: deckIdSchema, threadId: deckIdSchema })
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

  registry.register('ThemeProposalRequest', z.object(themeProposalRequestObjectSchema.shape))

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
    method: 'post',
    path: '/api/decks/import-pptx',
    summary: 'Import a PowerPoint file into a new workspace',
    request: {
      body: { content: { 'application/json': { schema: importPptxRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Created deck',
        content: { 'application/json': { schema: importPptxResponseSchema } },
      },
      400: jsonError,
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
    method: 'get',
    path: '/api/decks/{id}/export',
    summary: 'Export a self-contained HTML presentation',
    request: {
      params: deckIdParam,
      query: z.object({ sanitized: z.enum(['true', 'false']).optional() }),
    },
    responses: {
      200: { description: 'Self-contained HTML document' },
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
    path: '/api/workspaces/open',
    summary: 'Open an Ark workspace',
    request: {
      body: { content: { 'application/json': { schema: workspacePathRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Opened workspace',
        content: { 'application/json': { schema: deckResponseSchema } },
      },
      400: jsonError,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/workspaces/{id}/locate',
    summary: 'Locate a missing recent workspace',
    request: {
      params: deckIdParam,
      body: { content: { 'application/json': { schema: workspacePathRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Located workspace',
        content: { 'application/json': { schema: deckResponseSchema } },
      },
      400: jsonError,
    },
  })

  registry.registerPath({
    method: 'delete',
    path: '/api/workspaces/{id}/recent',
    summary: 'Remove a workspace from the recent index',
    request: { params: deckIdParam },
    responses: {
      204: { description: 'Recent entry removed' },
      400: jsonError,
    },
  })

  for (const action of ['save-as', 'move'] as const) {
    registry.registerPath({
      method: 'post',
      path: `/api/decks/{id}/${action}`,
      summary: action === 'save-as' ? 'Save a workspace as a new file' : 'Move a workspace file',
      request: {
        params: deckIdParam,
        body: { content: { 'application/json': { schema: workspacePathRequestSchema } } },
      },
      responses: {
        200: {
          description: 'Updated workspace location',
          content: { 'application/json': { schema: deckResponseSchema } },
        },
        400: jsonError,
        404: jsonError,
        409: jsonError,
        500: jsonError,
      },
    })
  }

  registry.registerPath({
    method: 'post',
    path: '/api/decks/{id}/duplicate',
    summary: 'Duplicate or share an Ark workspace',
    request: {
      params: deckIdParam,
      body: { content: { 'application/json': { schema: duplicateWorkspaceRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Duplicated workspace',
        content: { 'application/json': { schema: deckResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      409: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/decks/{id}/history',
    summary: 'List bounded document history in the workspace file',
    request: { params: deckIdParam },
    responses: {
      200: {
        description: 'Document history summaries, oldest first',
        content: { 'application/json': { schema: documentHistoryListResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/decks/{id}/history/restore',
    summary: 'Restore the current document from a history snapshot',
    request: {
      params: deckIdParam,
      body: { content: { 'application/json': { schema: restoreDocumentHistoryRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Restored deck',
        content: { 'application/json': { schema: restoreDocumentHistoryResponseSchema } },
      },
      400: {
        description: 'The snapshot is not a valid Ark deck',
        content: { 'application/json': { schema: deckValidationErrorResponseSchema } },
      },
      404: jsonError,
      409: {
        description: 'The document changed since the client last read it',
        content: { 'application/json': { schema: deckConflictErrorResponseSchema } },
      },
      500: jsonError,
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/decks/{id}/threads',
    summary: 'List workspace chat threads',
    request: { params: deckIdParam },
    responses: {
      200: {
        description: 'Chat threads',
        content: { 'application/json': { schema: chatThreadListResponseSchema } },
      },
      400: jsonError,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/decks/{id}/threads',
    summary: 'Create a workspace chat thread',
    request: {
      params: deckIdParam,
      body: { content: { 'application/json': { schema: createChatThreadRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Created chat thread',
        content: { 'application/json': { schema: chatThreadResponseSchema } },
      },
      400: jsonError,
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/decks/{id}/threads/{threadId}',
    summary: 'Rename, archive, or share a chat thread',
    request: {
      params: deckThreadParams,
      body: { content: { 'application/json': { schema: updateChatThreadRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Updated chat thread',
        content: { 'application/json': { schema: chatThreadResponseSchema } },
      },
      400: jsonError,
      404: jsonError,
    },
  })

  registry.registerPath({
    method: 'delete',
    path: '/api/decks/{id}/threads/{threadId}',
    summary: 'Delete a chat thread',
    request: { params: deckThreadParams },
    responses: {
      204: { description: 'Chat thread deleted' },
      400: jsonError,
      404: jsonError,
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
      409: jsonError,
      500: jsonError,
    },
  })

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

  registry.registerPath({
    method: 'get',
    path: '/api/runtimes',
    summary: 'List approved presentation runtimes',
    description:
      'Returns pinned runtime libraries (for example reveal.js, chart.js) and their `/api/runtimes/...` asset URLs. Deck HTML must reference only approved registry paths.',
    responses: {
      200: {
        description: 'Approved runtime registry summary',
        content: { 'application/json': { schema: runtimeRegistryResponseSchema } },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/runtimes/{runtimeId}/{version}/{assetPath}',
    summary: 'Serve an approved runtime asset',
    description:
      'Streams a vendored runtime file (JavaScript, CSS, fonts). `assetPath` may include subdirectories (for example `theme/white.css`).',
    request: { params: runtimeAssetParamsSchema },
    responses: {
      200: {
        description:
          'Runtime asset bytes. Response includes `Cache-Control`, `Access-Control-Allow-Origin`, `Cross-Origin-Resource-Policy`, `X-Content-Type-Options`, and `X-Checksum-Sha256` headers.',
      },
      400: jsonError,
      404: jsonError,
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/deck-assets',
    summary: 'Proxy an allowlisted remote deck asset',
    description:
      'Fetches a remote image, font, or stylesheet server-side when `ARK_DECK_ASSET_ALLOWLIST` includes the URL host. With no allowlist (default), returns 403.',
    request: { query: deckAssetProxyQuerySchema },
    responses: {
      200: {
        description: 'Proxied asset bytes with `Content-Type` and `Cache-Control` headers',
      },
      400: jsonError,
      403: {
        description: 'Host blocked or allowlist not configured',
        content: { 'application/json': { schema: deckAssetProxyBlockedResponseSchema } },
      },
      502: jsonError,
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
        'Private loopback API embedded in the Ark Electron application. Zod schemas in `packages/contracts/` are the source of truth.',
    },
    servers: [
      {
        url: 'http://127.0.0.1:{port}',
        description: 'Electron-managed internal API',
        variables: {
          port: { default: '8787', description: 'Dynamically allocated loopback port' },
        },
      },
    ],
  })
}
