import { z } from 'zod'

export const runtimeAssetKindSchema = z.enum(['script', 'stylesheet', 'font'])

export const runtimeAssetSummarySchema = z.object({
  path: z.string(),
  kind: runtimeAssetKindSchema,
  url: z.string(),
  sha256: z.string(),
  size: z.number().int().min(0),
})

export type RuntimeAssetSummary = z.infer<typeof runtimeAssetSummarySchema>

export const runtimeSummarySchema = z.object({
  id: z.string(),
  version: z.string(),
  runtimeMode: z.enum(['static', 'reveal', 'custom-js']),
  deprecated: z.boolean(),
  previewMode: z.enum(['css-only', 'full-js']),
  allowsDeckScripts: z.boolean(),
  assets: z.array(runtimeAssetSummarySchema),
})

export type RuntimeSummary = z.infer<typeof runtimeSummarySchema>

export const runtimeRegistryResponseSchema = z.object({
  schemaVersion: z.literal(1),
  runtimes: z.array(runtimeSummarySchema),
})

export type RuntimeRegistryResponse = z.infer<typeof runtimeRegistryResponseSchema>

const runtimeIdParam = z.string().min(1)
const runtimeVersionParam = z.string().min(1)

/** Path segment after `{version}/`; may include subdirectories (e.g. `theme/white.css`). */
export const runtimeAssetPathParamSchema = z.string().min(1)

export const runtimeAssetParamsSchema = z.object({
  runtimeId: runtimeIdParam,
  version: runtimeVersionParam,
  assetPath: runtimeAssetPathParamSchema,
})
