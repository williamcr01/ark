import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import {
  chatThreadListResponseSchema,
  chatThreadResponseSchema,
  createChatThreadRequestSchema,
  updateChatThreadRequestSchema,
} from '../chat.ts'
import { deckIdParam, deckThreadParams, jsonError } from './shared.ts'

export function registerThreadPaths(registry: OpenAPIRegistry) {
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
}
