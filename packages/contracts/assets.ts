import { z } from 'zod'

import { withRequestId } from './common.ts'
import { ASSET_SOURCES, MAX_ASSET_UPLOAD_BYTES } from '@ark/deck-core/assets.ts'

export const assetCategorySchema = z.enum(['image', 'text', 'pdf', 'other'])

export const assetSourceSchema = z.enum(ASSET_SOURCES as [string, ...string[]])

export const assetMetadataSchema = z.object({
  id: z.string().min(1),
  deckId: z.string().min(1).nullable(),
  chatMessageId: z.string().min(1).nullable(),
  filename: z.string(),
  mediaType: z.string(),
  category: assetCategorySchema,
  byteSize: z.number().int().min(0),
  checksum: z.string(),
  source: assetSourceSchema,
  storageKind: z.string(),
  url: z.string(),
  createdAt: z.string(),
})

export type AssetMetadataResponse = z.infer<typeof assetMetadataSchema>

const chatMessageIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'Invalid chat message id.',
  )

/**
 * Upload request. Bytes are transported as a base64 string (or `data:` URL),
 * consistent with how deck attachments already travel over JSON. The server
 * decodes, sniffs, and validates before persisting.
 */
export const uploadAssetRequestSchema = z.object({
  filename: z.string().min(1, 'A filename is required.').max(1024),
  // Browsers may leave File.type empty for otherwise valid image extensions.
  mediaType: z.string(),
  data: z
    .string()
    .min(1, 'File data is required.')
    // Roughly cap the base64 payload; exact byte checks happen server-side.
    .max(Math.ceil((MAX_ASSET_UPLOAD_BYTES * 4) / 3) + 256, 'File is too large.'),
  chatMessageId: chatMessageIdSchema.nullable().optional(),
  source: assetSourceSchema.optional(),
})

export type UploadAssetRequest = z.infer<typeof uploadAssetRequestSchema>

export const uploadAssetResponseSchema = withRequestId({
  asset: assetMetadataSchema,
})

export type UploadAssetResponse = z.infer<typeof uploadAssetResponseSchema>

export const assetListResponseSchema = withRequestId({
  assets: z.array(assetMetadataSchema),
})

export type AssetListResponse = z.infer<typeof assetListResponseSchema>

export const assetResponseSchema = withRequestId({
  asset: assetMetadataSchema,
})

export type AssetResponse = z.infer<typeof assetResponseSchema>
