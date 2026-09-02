import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import {
  createDeckRequestSchema,
  createDeckResponseSchema,
  deckListResponseSchema,
  deckResponseSchema,
  deckValidationErrorResponseSchema,
  importPptxRequestSchema,
  importPptxResponseSchema,
} from '../decks.ts'
import { deckIdParam, jsonError } from './shared.ts'

export function registerDeckCollectionPaths(registry: OpenAPIRegistry) {
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
}
