import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import {
  apiErrorPayloadSchema,
  deckIdSchema,
  generationJobIdSchema,
  simpleErrorResponseSchema,
} from '../common.ts'

export type ArkOpenApiRegistry = OpenAPIRegistry

export const deckIdParam = z.object({ id: deckIdSchema })
export const deckAssetParams = z.object({ id: deckIdSchema, assetId: z.string().min(1) })
export const deckThreadParams = z.object({ id: deckIdSchema, threadId: deckIdSchema })
export const generationJobParams = z.object({ id: generationJobIdSchema })
export const previewTokenParams = z.object({ token: z.string().min(1) })

export const jsonError = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: simpleErrorResponseSchema,
    },
  },
}

export const jsonApiError = {
  description: 'API error with code',
  content: {
    'application/json': {
      schema: apiErrorPayloadSchema,
    },
  },
}
