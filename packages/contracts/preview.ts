import { z } from 'zod'

import { withRequestId } from './common.ts'

export const createPreviewSessionRequestSchema = z.object({
  html: z.string().refine((value) => value.trim().length > 0, 'HTML is required.'),
  editorBridge: z.boolean().optional(),
})

export type CreatePreviewSessionRequest = z.infer<typeof createPreviewSessionRequestSchema>

export const previewSessionResponseSchema = withRequestId({
  token: z.string().min(1),
  /** Generation-correlation value for the bridge handshake (not a secret). */
  handshake: z.string().min(1),
  expiresAt: z.number(),
  sandboxOrigin: z.string(),
  renderUrl: z.string(),
})

export type PreviewSessionResponse = z.infer<typeof previewSessionResponseSchema>

export const getPreviewSessionResponseSchema = withRequestId({
  token: z.string().min(1),
  handshake: z.string().min(1),
  html: z.string(),
  editorBridge: z.boolean(),
  expiresAt: z.number(),
})

export type GetPreviewSessionResponse = z.infer<typeof getPreviewSessionResponseSchema>
