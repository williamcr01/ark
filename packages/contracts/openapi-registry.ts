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

import { themeProposalRequestObjectSchema } from './mcp.ts'
import { registerAssetPaths } from './openapi-registry/assets.ts'
import { registerChatPaths } from './openapi-registry/chat.ts'
import { registerDeckAssetProxyPaths } from './openapi-registry/deck-assets.ts'
import { registerDeckMutationPaths } from './openapi-registry/deck-mutations.ts'
import { registerDeckCollectionPaths } from './openapi-registry/decks.ts'
import { registerGenerationPaths } from './openapi-registry/generation.ts'
import { registerHealthPaths } from './openapi-registry/health.ts'
import { registerHistoryPaths } from './openapi-registry/history.ts'
import { registerPreviewPaths } from './openapi-registry/preview.ts'
import { registerRuntimeErrorPaths } from './openapi-registry/runtime-errors.ts'
import { registerRuntimePaths } from './openapi-registry/runtimes.ts'
import { registerThreadPaths } from './openapi-registry/threads.ts'
import { registerThumbnailPaths } from './openapi-registry/thumbnails.ts'
import { registerWorkspacePaths } from './openapi-registry/workspaces.ts'

extendZodWithOpenApi(z)

export function createArkOpenApiRegistry() {
  const registry = new OpenAPIRegistry()

  registry.register('ThemeProposalRequest', z.object(themeProposalRequestObjectSchema.shape))
  registerHealthPaths(registry)
  registerDeckCollectionPaths(registry)
  registerDeckMutationPaths(registry)
  registerChatPaths(registry)
  registerWorkspacePaths(registry)
  registerHistoryPaths(registry)
  registerThreadPaths(registry)
  registerAssetPaths(registry)
  registerGenerationPaths(registry)
  registerPreviewPaths(registry)
  registerThumbnailPaths(registry)
  registerRuntimeErrorPaths(registry)
  registerRuntimePaths(registry)
  registerDeckAssetProxyPaths(registry)

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
