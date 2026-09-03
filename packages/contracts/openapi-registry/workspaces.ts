import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import {
  deckResponseSchema,
  duplicateWorkspaceRequestSchema,
  workspacePathRequestSchema,
} from '../decks.ts'
import { deckIdParam, jsonError } from './shared.ts'

export function registerWorkspacePaths(registry: OpenAPIRegistry) {
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
}
