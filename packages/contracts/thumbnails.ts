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
  slideIndex: z
    .string()
    .regex(/^\d+$/, 'Invalid slide index.')
    .transform((value) => Number(value)),
})

export type DeckThumbnailImageParams = z.infer<typeof deckThumbnailImageParamsSchema>
