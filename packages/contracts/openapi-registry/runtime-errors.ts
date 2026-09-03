import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { runtimeErrorInputSchema, runtimeErrorResponseSchema } from '../runtime-errors.ts'
import { jsonError } from './shared.ts'

export function registerRuntimeErrorPaths(registry: OpenAPIRegistry) {
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
}
