import { z } from 'zod'

import { deckIdSchema, withRequestId } from './common.ts'

export const thumbnailStatusSchema = z.enum(['ready', 'pending', 'failed', 'disabled'])

export type ThumbnailStatus = z.infer<typeof thumbnailStatusSchema>

export const thumbnailSlideSchema = z.object({
  index: z.number().int().nonnegative(),
  url: z.string().min(1),
})

export type ThumbnailSlide = z.infer<typeof thumbnailSlideSchema>

export const deckThumbnailsQuerySchema = z.object({
  versionId: deckIdSchema,
})

export type DeckThumbnailsQuery = z.infer<typeof deckThumbnailsQuerySchema>

export const deckThumbnailsResponseSchema = withRequestId({
  status: thumbnailStatusSchema,
  slides: z.array(thumbnailSlideSchema),
  error: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export type DeckThumbnailsResponse = z.infer<typeof deckThumbnailsResponseSchema>

export const deckThumbnailImageParamsSchema = z.object({
  id: deckIdSchema,
  versionId: deckIdSchema,
  slideFile: z.string().regex(/^\d+\.png$/i, 'Invalid slide image path.'),
})

export type DeckThumbnailImageParams = z.infer<typeof deckThumbnailImageParamsSchema>

/**
 * The route receives an opaque, full-length manifest fingerprint rather than
 * a shortened manifest prefix so image URLs cannot collide across manifests.
 */
export const deckThumbnailImageQuerySchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/i, 'Invalid thumbnail manifest fingerprint.'),
})

export type DeckThumbnailImageQuery = z.infer<typeof deckThumbnailImageQuerySchema>
