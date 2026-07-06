import { z } from 'zod'

import { withRequestId } from './common.ts'

export const createPreviewSessionRequestSchema = z.object({
  html: z.string().min(1, 'HTML is required.'),
})

export type CreatePreviewSessionRequest = z.infer<typeof createPreviewSessionRequestSchema>

export const previewSessionResponseSchema = withRequestId({
  token: z.string().min(1),
  expiresAt: z.number(),
  sandboxOrigin: z.string(),
  renderUrl: z.string(),
})

export type PreviewSessionResponse = z.infer<typeof previewSessionResponseSchema>

export const getPreviewSessionResponseSchema = withRequestId({
  token: z.string().min(1),
  html: z.string(),
  expiresAt: z.number(),
})

export type GetPreviewSessionResponse = z.infer<typeof getPreviewSessionResponseSchema>
