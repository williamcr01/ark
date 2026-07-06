import { z } from 'zod'

import type { DeckRuntimeManifest } from '../deck-runtime-manifest.ts'
import { isDeckRuntimeManifest } from '../deck-runtime-manifest.ts'
import { deckIdSchema, withRequestId } from './common.ts'

export { isValidDeckId } from './common.ts'

export const deckVersionSourceSchema = z.enum(['manual', 'agent', 'upload', 'repair', 'rollback'])

export type DeckVersionSource = z.infer<typeof deckVersionSourceSchema>

export const deckValidationStatusSchema = z.enum(['unknown', 'valid', 'invalid'])

export type DeckValidationStatus = z.infer<typeof deckValidationStatusSchema>

export const storedDeckSchema = z.object({
  id: deckIdSchema,
  html: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  activeVersionId: deckIdSchema.nullable().optional(),
  versionNumber: z.number().int().nullable().optional(),
})

export type StoredDeck = z.infer<typeof storedDeckSchema>

export const deckSummarySchema = storedDeckSchema.omit({ html: true })

export type DeckSummary = z.infer<typeof deckSummarySchema>

const deckRuntimeManifestSchema = z.custom<DeckRuntimeManifest>((value) =>
  isDeckRuntimeManifest(value),
)

export const deckVersionSummarySchema = z.object({
  id: deckIdSchema,
  deckId: deckIdSchema,
  versionNumber: z.number().int().min(1),
  title: z.string(),
  source: deckVersionSourceSchema,
  summary: z.string().nullable(),
  validationStatus: deckValidationStatusSchema,
  runtimeManifest: deckRuntimeManifestSchema.nullable(),
  createdAt: z.string(),
  isActive: z.boolean(),
})

export type DeckVersionSummary = z.infer<typeof deckVersionSummarySchema>

export const deckVersionDetailSchema = deckVersionSummarySchema.extend({
  html: z.string(),
})

export type DeckVersionDetail = z.infer<typeof deckVersionDetailSchema>

export const deckVersionOptionsFieldsSchema = z.object({
  source: deckVersionSourceSchema.optional(),
  summary: z.string().nullable().optional(),
  modelProvider: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
})

export type DeckVersionOptions = z.infer<typeof deckVersionOptionsFieldsSchema>

export const deckValidationReportSchema = z
  .object({
    valid: z.boolean(),
    slideCount: z.number().int().min(0),
    scripts: z.array(
      z.object({
        inline: z.boolean(),
        src: z.string().optional(),
        type: z.string().optional(),
      }),
    ),
    forms: z.number().int().min(0),
    iframes: z.number().int().min(0),
    externalUrls: z.array(z.string()),
    malformedSlides: z.array(
      z.object({
        index: z.number().int().min(0),
        reason: z.enum(['nested_slide', 'empty']),
      }),
    ),
    runtimeMarkers: z.object({}).passthrough(),
    issues: z.array(
      z.object({
        code: z.string(),
        message: z.string(),
        severity: z.enum(['error', 'warning']),
      }),
    ),
  })
  .passthrough()

export type DeckValidationReport = z.infer<typeof deckValidationReportSchema>

export const createDeckRequestSchema = z.object({
  html: z.string().refine((value) => value.trim().length > 0, 'HTML is required.'),
  ...deckVersionOptionsFieldsSchema.shape,
})

export type CreateDeckRequest = z.infer<typeof createDeckRequestSchema>

export const updateDeckRequestSchema = createDeckRequestSchema

export type UpdateDeckRequest = z.infer<typeof updateDeckRequestSchema>

export const renameDeckRequestSchema = z.object({
  title: z.string().min(1, 'Deck title is required.'),
})

export type RenameDeckRequest = z.infer<typeof renameDeckRequestSchema>

export const rollbackDeckRequestSchema = z.object({
  versionId: deckIdSchema,
})

export type RollbackDeckRequest = z.infer<typeof rollbackDeckRequestSchema>

export const deckResponseSchema = withRequestId({
  deck: storedDeckSchema,
})

export type DeckResponse = z.infer<typeof deckResponseSchema>

export const deckListResponseSchema = withRequestId({
  decks: z.array(deckSummarySchema),
})

export type DeckListResponse = z.infer<typeof deckListResponseSchema>

export const deckVersionListResponseSchema = withRequestId({
  versions: z.array(deckVersionSummarySchema),
})

export type DeckVersionListResponse = z.infer<typeof deckVersionListResponseSchema>

export const deckVersionResponseSchema = withRequestId({
  version: deckVersionDetailSchema,
})

export type DeckVersionResponse = z.infer<typeof deckVersionResponseSchema>

export const createDeckResponseSchema = withRequestId({
  deck: storedDeckSchema,
  validation: deckValidationReportSchema,
  runtimeManifest: deckRuntimeManifestSchema.nullable(),
})

export type CreateDeckResponse = z.infer<typeof createDeckResponseSchema>

export const deckPatchResultSchema = z.object({
  appliedCount: z.number().int().min(0),
  changedSlideIndexes: z.array(z.number().int().min(0)),
  changedElementIds: z.array(z.string()),
  summary: z.string(),
  suggestedActiveSlideIndex: z.number().int().min(0).optional(),
})

export const deckPatchResponseSchema = withRequestId({
  deck: storedDeckSchema,
  validation: deckValidationReportSchema,
  patch: deckPatchResultSchema,
})

export type DeckPatchResponse = z.infer<typeof deckPatchResponseSchema>

export const deckRollbackResponseSchema = withRequestId({
  deck: storedDeckSchema,
  validation: deckValidationReportSchema,
})

export type DeckRollbackResponse = z.infer<typeof deckRollbackResponseSchema>

export const deckValidationErrorResponseSchema = withRequestId({
  error: z.string(),
  validation: deckValidationReportSchema,
})

export type DeckValidationErrorResponse = z.infer<typeof deckValidationErrorResponseSchema>

export const deckPatchErrorResponseSchema = withRequestId({
  error: z.string(),
  operationIndex: z.number().int().min(0).optional(),
})

export type DeckPatchErrorResponse = z.infer<typeof deckPatchErrorResponseSchema>

export function normalizeDeckVersionSource(source: unknown): DeckVersionSource {
  const parsed = deckVersionSourceSchema.safeParse(source)
  return parsed.success ? parsed.data : 'manual'
}

export function normalizeDeckTitle(title: unknown) {
  return typeof title === 'string' && title.trim() ? title.trim() : 'Untitled deck'
}
