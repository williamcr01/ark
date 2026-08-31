import { z } from 'zod'

import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import { isDeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import { withRequestId } from './common.ts'

export { isValidDeckId } from './common.ts'
export {
  DECK_ORIGINS,
  DEFAULT_DECK_ORIGIN,
  isDeckOrigin,
  normalizeDeckOrigin,
  type DeckOrigin,
} from '@ark/deck/document/origin.ts'

export {
  deckOriginSchema,
  deckSummarySchema,
  storedDeckSchema,
} from '@ark/storage/records/stored-deck.ts'
export type { DeckSummary, StoredDeck } from '@ark/storage/records/stored-deck.ts'
import {
  deckOriginSchema,
  deckSummarySchema,
  storedDeckSchema,
} from '@ark/storage/records/stored-deck.ts'

const deckRuntimeManifestSchema: z.ZodType<DeckRuntimeManifest> = z
  .object({
    schemaVersion: z.number().optional(),
    runtimeMode: z.string().optional(),
    previewMode: z.string().optional(),
    slideCount: z.number().optional(),
    structure: z.enum(['plain', 'reveal', 'unknown']).optional(),
    slideSelector: z.string().nullable().optional(),
    aspectRatio: z.string().optional(),
  })
  .passthrough()
  .refine((value) => isDeckRuntimeManifest(value), 'Invalid runtime manifest.')

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

export const createDeckRequestSchema = z
  .object({
    html: z.string().refine((value) => value.trim().length > 0, 'HTML is required.'),
    origin: deckOriginSchema.optional(),
  })
  .strict()

export type CreateDeckRequest = z.infer<typeof createDeckRequestSchema>

export const importPptxRequestSchema = z
  .object({
    path: z.string().min(1).optional(),
    filename: z.string().min(1).max(500).optional(),
    bytes: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.path?.trim() || value.bytes?.trim()), {
    message: 'Provide a file path or the PPTX bytes.',
  })

export type ImportPptxRequest = z.infer<typeof importPptxRequestSchema>

// Updates never carry an origin: writing content is what retires `blank`.
export const updateDeckRequestSchema = createDeckRequestSchema.omit({ origin: true }).extend({
  expectedDocumentRevision: z.number().int().min(1),
})

export type UpdateDeckRequest = z.infer<typeof updateDeckRequestSchema>

export const renameDeckRequestSchema = z.object({
  title: z.string().min(1, 'Deck title is required.'),
})

export type RenameDeckRequest = z.infer<typeof renameDeckRequestSchema>

export const workspacePathRequestSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine((value) => value.toLowerCase().endsWith('.ark'), 'Expected an .ark file.'),
  /** Replace an existing file at the target path instead of refusing. */
  overwrite: z.boolean().optional(),
})

export const duplicateWorkspaceRequestSchema = z.object({
  path: workspacePathRequestSchema.shape.path.optional(),
  mode: z.enum(['presentation', 'complete']),
  threadIds: z.array(z.string().min(1)).optional(),
  /** Replace an existing file at the target path instead of refusing. */
  overwrite: z.boolean().optional(),
})

export const deckResponseSchema = withRequestId({
  deck: storedDeckSchema,
})

export type DeckResponse = z.infer<typeof deckResponseSchema>

export const deckListResponseSchema = withRequestId({
  decks: z.array(deckSummarySchema),
})

export type DeckListResponse = z.infer<typeof deckListResponseSchema>

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

export const deckConflictErrorResponseSchema = withRequestId({
  error: z.string(),
  code: z.literal('document_conflict'),
  currentDocumentRevision: z.number().int().min(1),
})

export type DeckConflictErrorResponse = z.infer<typeof deckConflictErrorResponseSchema>

export { deckPatchRequestSchema } from '@ark/deck/patch/patch-request.ts'
export type { DeckPatchRequest } from '@ark/deck/patch/patch-request.ts'

export { extractDeckTitle, normalizeDeckTitle } from '@ark/deck/document/title.ts'
