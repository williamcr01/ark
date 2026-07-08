import { z } from 'zod'

import { simpleErrorResponseSchema } from './common.ts'

export const deckAssetProxyQuerySchema = z.object({
  url: z.string().min(1, 'url query parameter is required.'),
})

export type DeckAssetProxyQuery = z.infer<typeof deckAssetProxyQuerySchema>

/** Returned when `ARK_DECK_ASSET_ALLOWLIST` is unset or the host is not allowlisted. */
export const deckAssetProxyBlockedResponseSchema = simpleErrorResponseSchema.extend({
  proxyUrl: z.string(),
})

export type DeckAssetProxyBlockedResponse = z.infer<typeof deckAssetProxyBlockedResponseSchema>
