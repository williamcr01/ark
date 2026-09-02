import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import {
  appendChatMessageRequestSchema,
  appendChatMessageResponseSchema,
  deckChatQuerySchema,
  deckChatResponseSchema,
} from '../chat.ts'
import { deckIdParam, jsonError } from './shared.ts'

export function registerChatPaths(registry: OpenAPIRegistry) {
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
}
