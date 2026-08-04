import { z } from 'zod'

import { deckIdSchema, withRequestId } from './common.ts'

export const THUMBNAIL_LONG_POLL_MAX_WAIT_MS = 5_000

export const thumbnailStatusSchema = z.enum(['ready', 'pending', 'failed', 'disabled'])

export type ThumbnailStatus = z.infer<typeof thumbnailStatusSchema>

export const thumbnailSlideSchema = z.object({
  index: z.number().int().nonnegative(),
  url: z.string().min(1),
})

export type ThumbnailSlide = z.infer<typeof thumbnailSlideSchema>

export const deckThumbnailsQuerySchema = z.object({
  documentRevision: z.coerce.number().int().min(1),
  waitMs: z.coerce.number().int().min(0).max(THUMBNAIL_LONG_POLL_MAX_WAIT_MS).optional().default(0),
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
  documentRevision: z.coerce.number().int().min(1),
  slideFile: z.string().regex(/^\d+\.png$/i, 'Invalid slide image path.'),
})

export type DeckThumbnailImageParams = z.infer<typeof deckThumbnailImageParamsSchema>

/**
 * The route receives an opaque, full-length slide thumbnail fingerprint so
 * immutable image URLs cannot collide across document revisions or slide content.
 */
export const deckThumbnailImageQuerySchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/i, 'Invalid thumbnail fingerprint.'),
})

export type DeckThumbnailImageQuery = z.infer<typeof deckThumbnailImageQuerySchema>
