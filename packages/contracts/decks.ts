import { z } from 'zod'

import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import { isDeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import { DECK_ORIGINS } from '@ark/deck-core/deck-origin.ts'
import { deckIdSchema, withRequestId } from './common.ts'

export { isValidDeckId } from './common.ts'
export {
  DECK_ORIGINS,
  DEFAULT_DECK_ORIGIN,
  isDeckOrigin,
  normalizeDeckOrigin,
  type DeckOrigin,
} from '@ark/deck-core/deck-origin.ts'

export const deckOriginSchema = z.enum(DECK_ORIGINS)

export const storedDeckSchema = z.object({
  id: deckIdSchema,
  html: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  documentRevision: z.number().int().min(1),
  origin: deckOriginSchema,
  filePath: z.string().min(1),
})

export type StoredDeck = z.infer<typeof storedDeckSchema>

// Origin is deliberately absent from summaries: the recent list is built from
// closed files that are never migrated or opened just to read it.
export const deckSummarySchema = storedDeckSchema
  .omit({ html: true, documentRevision: true, origin: true })
  .extend({
    documentRevision: z.number().int().min(1).nullable(),
    missing: z.boolean().optional(),
    cover: z.string().optional(),
  })

export type DeckSummary = z.infer<typeof deckSummarySchema>

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
})

export const duplicateWorkspaceRequestSchema = z.object({
  path: workspacePathRequestSchema.shape.path.optional(),
  mode: z.enum(['presentation', 'complete']),
  threadIds: z.array(z.string().min(1)).optional(),
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

export { deckPatchRequestSchema } from '@ark/deck-core/deck-patch.ts'
export type { DeckPatchRequest } from '@ark/deck-core/deck-patch.ts'

export function normalizeDeckTitle(title: unknown) {
  return typeof title === 'string' && title.trim() ? title.trim() : 'Untitled deck'
}

/** Extract a display title from deck HTML (`<title>`), matching server persistence. */
export function extractDeckTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  return normalizeDeckTitle(match?.[1])
}
