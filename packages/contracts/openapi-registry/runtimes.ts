import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { runtimeAssetParamsSchema, runtimeRegistryResponseSchema } from '../runtimes.ts'
import { jsonError } from './shared.ts'

export function registerRuntimePaths(registry: OpenAPIRegistry) {
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
}
