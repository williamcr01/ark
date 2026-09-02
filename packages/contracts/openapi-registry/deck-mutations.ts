import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import {
  createDeckResponseSchema,
  deckPatchErrorResponseSchema,
  deckPatchRequestSchema,
  deckPatchResponseSchema,
  deckResponseSchema,
  deckValidationErrorResponseSchema,
  renameDeckRequestSchema,
  updateDeckRequestSchema,
} from '../decks.ts'
import { deckIdParam, jsonError } from './shared.ts'

export function registerDeckMutationPaths(registry: OpenAPIRegistry) {
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
}
