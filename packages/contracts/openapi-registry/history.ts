import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import {
  deckConflictErrorResponseSchema,
  deckValidationErrorResponseSchema,
  documentHistoryListResponseSchema,
  restoreDocumentHistoryRequestSchema,
  restoreDocumentHistoryResponseSchema,
} from '../decks.ts'
import { deckIdParam, jsonError } from './shared.ts'

export function registerHistoryPaths(registry: OpenAPIRegistry) {
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
}
