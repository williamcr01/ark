import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import {
  deckAssetProxyBlockedResponseSchema,
  deckAssetProxyQuerySchema,
} from '../deck-asset-proxy.ts'
import { jsonError } from './shared.ts'

export function registerDeckAssetProxyPaths(registry: OpenAPIRegistry) {
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
}
