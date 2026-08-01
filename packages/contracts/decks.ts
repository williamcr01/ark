import { z } from 'zod'

import type { DeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
import { isDeckRuntimeManifest } from '@ark/runtime-registry/deck-runtime-manifest.ts'
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
  activeVersionId: deckIdSchema,
  versionNumber: z.number().int().min(1),
})

export type StoredDeck = z.infer<typeof storedDeckSchema>

export const deckSummarySchema = storedDeckSchema.omit({ html: true })

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

export const deckProvenanceOperationSchema = z.enum([
  'add_slide',
  'delete_slide',
  'replace_slide',
  'reorder_slide',
  'update_slide_title',
  'update_slide_notes',
  'replace_text',
  'insert_element',
  'delete_element',
  'duplicate_element',
  'set_attrs',
  'set_inline_style',
  'move_element',
  'resize_element',
  'reorder_element',
  'lock_element',
  'unlock_element',
  'text_replace',
  'undo',
  'redo',
])

export type DeckProvenanceOperation = z.infer<typeof deckProvenanceOperationSchema>

export const deckVersionProvenanceSchema = z.object({
  operations: z.array(deckProvenanceOperationSchema).max(40).optional(),
  slideIndexes: z.array(z.number().int().min(0)).max(100).optional(),
  elementIds: z.array(z.string().max(128)).max(200).optional(),
  jobId: z.string().max(64).optional(),
  stepCount: z.number().int().min(0).optional(),
  toolCalls: z
    .array(
      z.object({
        toolName: z.string().max(64),
        summary: z.string().max(300),
        error: z.boolean().optional(),
      }),
    )
    .max(50)
    .optional(),
  restoredVersionId: deckIdSchema.optional(),
  restoredVersionNumber: z.number().int().min(1).optional(),
  runtimeManifestHash: z.string().max(64).optional(),
})

export type DeckVersionProvenance = z.infer<typeof deckVersionProvenanceSchema>

/** Client-supplied provenance on create/update — manual fields only. */
export const deckManualVersionProvenanceSchema = deckVersionProvenanceSchema.pick({
  operations: true,
  slideIndexes: true,
  elementIds: true,
})

export type DeckManualVersionProvenance = z.infer<typeof deckManualVersionProvenanceSchema>

export const DECK_VERSION_SLIDE_TITLE_MAX = 200
export const DECK_VERSION_SUMMARY_MAX = 500
export const DECK_VERSION_ASSET_URL_MAX = 2048

const deckVersionSlideTitleSchema = z.string().max(DECK_VERSION_SLIDE_TITLE_MAX)
const deckVersionAssetUrlSchema = z.string().max(DECK_VERSION_ASSET_URL_MAX)

export const deckVersionDiffSchema = z.object({
  kind: z.enum(['structural', 'coarse']),
  slideCountBefore: z.number().int().min(0).optional(),
  slideCountAfter: z.number().int().min(0).optional(),
  addedSlides: z
    .array(
      z.object({
        index: z.number().int().min(0),
        title: deckVersionSlideTitleSchema,
      }),
    )
    .max(100)
    .optional(),
  deletedSlides: z
    .array(
      z.object({
        index: z.number().int().min(0),
        title: deckVersionSlideTitleSchema,
      }),
    )
    .max(100)
    .optional(),
  movedSlides: z
    .array(
      z.object({
        fromIndex: z.number().int().min(0),
        toIndex: z.number().int().min(0),
      }),
    )
    .max(100)
    .optional(),
  changedSlides: z
    .array(
      z.object({
        index: z.number().int().min(0),
        titleChanged: z.boolean().optional(),
        notesChanged: z.boolean().optional(),
        contentChanged: z.boolean().optional(),
        title: deckVersionSlideTitleSchema.optional(),
      }),
    )
    .max(100)
    .optional(),
  titleChanged: z.boolean().optional(),
  assetsAdded: z.array(deckVersionAssetUrlSchema).max(50).optional(),
  assetsRemoved: z.array(deckVersionAssetUrlSchema).max(50).optional(),
  htmlBytesBefore: z.number().int().min(0).optional(),
  htmlBytesAfter: z.number().int().min(0).optional(),
})

export type DeckVersionDiff = z.infer<typeof deckVersionDiffSchema>

/** Client-writable version fields on create/update — never includes diff or model metadata. */
export const deckClientVersionSourceSchema = z.enum(['manual', 'upload'])

export type DeckClientVersionSource = z.infer<typeof deckClientVersionSourceSchema>

/**
 * Public create/update options. Source is a plain string so spoofed values
 * (`agent`, `rollback`) are accepted then coerced server-side to `manual`.
 * Diff and model fields are intentionally omitted from the request contract.
 */
export const deckClientVersionOptionsSchema = z.object({
  source: z.string().optional(),
  summary: z.string().nullable().optional(),
  provenance: deckManualVersionProvenanceSchema.optional(),
})

export type DeckClientVersionOptions = z.infer<typeof deckClientVersionOptionsSchema>

export const deckVersionSummarySchema = z.object({
  id: deckIdSchema,
  deckId: deckIdSchema,
  versionNumber: z.number().int().min(1),
  title: z.string(),
  source: deckVersionSourceSchema,
  summary: z.string().nullable(),
  validationStatus: deckValidationStatusSchema,
  runtimeManifest: deckRuntimeManifestSchema.nullable(),
  modelProvider: z.string().nullable(),
  modelName: z.string().nullable(),
  provenance: deckVersionProvenanceSchema.nullable(),
  diff: deckVersionDiffSchema.nullable(),
  createdAt: z.string(),
  isActive: z.boolean(),
})

export type DeckVersionSummary = z.infer<typeof deckVersionSummarySchema>

export const deckVersionDetailSchema = deckVersionSummarySchema.extend({
  html: z.string(),
})

export type DeckVersionDetail = z.infer<typeof deckVersionDetailSchema>

/** Full version options used by stores and trusted server callers. */
export const deckVersionOptionsFieldsSchema = z.object({
  source: deckVersionSourceSchema.optional(),
  summary: z.string().max(DECK_VERSION_SUMMARY_MAX).nullable().optional(),
  modelProvider: z.string().max(64).nullable().optional(),
  modelName: z.string().max(128).nullable().optional(),
  provenance: deckVersionProvenanceSchema.optional(),
  diff: deckVersionDiffSchema.optional(),
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
  ...deckClientVersionOptionsSchema.shape,
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

export { deckPatchRequestSchema } from '@ark/deck-core/deck-patch.ts'
export type { DeckPatchRequest } from '@ark/deck-core/deck-patch.ts'

export function normalizeDeckVersionSource(source: unknown): DeckVersionSource {
  const parsed = deckVersionSourceSchema.safeParse(source)
  return parsed.success ? parsed.data : 'manual'
}

export function normalizeDeckTitle(title: unknown) {
  return typeof title === 'string' && title.trim() ? title.trim() : 'Untitled deck'
}

/** Extract a display title from deck HTML (`<title>`), matching server persistence. */
export function extractDeckTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  return normalizeDeckTitle(match?.[1])
}

export function truncateDeckVersionText(value: string, maxLength: number) {
  const withoutHtml = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (withoutHtml.length <= maxLength) {
    return withoutHtml
  }

  return `${withoutHtml.slice(0, maxLength - 1)}…`
}

export function truncateDeckVersionSummary(summary: string) {
  return truncateDeckVersionText(summary, DECK_VERSION_SUMMARY_MAX)
}

export function truncateDeckVersionSlideTitle(title: string) {
  return truncateDeckVersionText(title, DECK_VERSION_SLIDE_TITLE_MAX)
}

/** Compact oversized or data: asset URLs so diffs stay bounded and agent-safe. */
export function sanitizeDeckVersionAssetUrl(url: string) {
  const trimmed = url.trim()

  if (!trimmed) {
    return trimmed
  }

  if (/^data:/i.test(trimmed)) {
    const commaIndex = trimmed.indexOf(',')
    const header =
      commaIndex >= 0 ? trimmed.slice(0, Math.min(commaIndex, 80)) : trimmed.slice(0, 80)
    const fingerprint = simpleStringFingerprint(trimmed)
    return truncateDeckVersionText(
      `data-asset:${header};len=${trimmed.length};fp=${fingerprint}`,
      DECK_VERSION_ASSET_URL_MAX,
    )
  }

  if (trimmed.length <= DECK_VERSION_ASSET_URL_MAX) {
    return trimmed
  }

  const fingerprint = simpleStringFingerprint(trimmed)
  return truncateDeckVersionText(
    `${trimmed.slice(0, 120)}…;len=${trimmed.length};fp=${fingerprint}`,
    DECK_VERSION_ASSET_URL_MAX,
  )
}

function simpleStringFingerprint(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

function sanitizeSlideRef(entry: { index: number; title: string }) {
  return {
    index: entry.index,
    title: truncateDeckVersionSlideTitle(entry.title),
  }
}

function sanitizeChangedSlide(entry: {
  index: number
  titleChanged?: boolean
  notesChanged?: boolean
  contentChanged?: boolean
  title?: string
}) {
  return {
    index: entry.index,
    ...(entry.titleChanged ? { titleChanged: true } : {}),
    ...(entry.notesChanged ? { notesChanged: true } : {}),
    ...(entry.contentChanged ? { contentChanged: true } : {}),
    ...(typeof entry.title === 'string'
      ? { title: truncateDeckVersionSlideTitle(entry.title) }
      : {}),
  }
}

export function normalizeDeckVersionProvenance(provenance: unknown): DeckVersionProvenance | null {
  if (!provenance || typeof provenance !== 'object') {
    return null
  }

  const candidate = { ...(provenance as Record<string, unknown>) }

  if (Array.isArray(candidate.toolCalls)) {
    candidate.toolCalls = candidate.toolCalls
      .filter(
        (call): call is { toolName?: unknown; summary?: unknown; error?: unknown } =>
          Boolean(call) && typeof call === 'object',
      )
      .slice(0, 50)
      .map((call) => ({
        toolName: typeof call.toolName === 'string' ? call.toolName.slice(0, 64) : 'unknown',
        summary: typeof call.summary === 'string' ? truncateDeckVersionText(call.summary, 300) : '',
        ...(call.error === true ? { error: true } : {}),
      }))
  }

  const parsed = deckVersionProvenanceSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export function normalizeDeckVersionDiff(diff: unknown): DeckVersionDiff | null {
  if (!diff || typeof diff !== 'object') {
    return null
  }

  const candidate = { ...(diff as Record<string, unknown>) }

  if (Array.isArray(candidate.addedSlides)) {
    candidate.addedSlides = candidate.addedSlides
      .filter(
        (entry): entry is { index: number; title: string } =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          typeof (entry as { index?: unknown }).index === 'number' &&
          typeof (entry as { title?: unknown }).title === 'string',
      )
      .slice(0, 100)
      .map(sanitizeSlideRef)
  }

  if (Array.isArray(candidate.deletedSlides)) {
    candidate.deletedSlides = candidate.deletedSlides
      .filter(
        (entry): entry is { index: number; title: string } =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          typeof (entry as { index?: unknown }).index === 'number' &&
          typeof (entry as { title?: unknown }).title === 'string',
      )
      .slice(0, 100)
      .map(sanitizeSlideRef)
  }

  if (Array.isArray(candidate.changedSlides)) {
    candidate.changedSlides = candidate.changedSlides
      .filter(
        (
          entry,
        ): entry is {
          index: number
          titleChanged?: boolean
          notesChanged?: boolean
          contentChanged?: boolean
          title?: string
        } =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          typeof (entry as { index?: unknown }).index === 'number',
      )
      .slice(0, 100)
      .map(sanitizeChangedSlide)
  }

  if (Array.isArray(candidate.movedSlides)) {
    candidate.movedSlides = candidate.movedSlides.slice(0, 100)
  }

  if (Array.isArray(candidate.assetsAdded)) {
    candidate.assetsAdded = candidate.assetsAdded
      .filter((url): url is string => typeof url === 'string')
      .map(sanitizeDeckVersionAssetUrl)
      .slice(0, 50)
  }

  if (Array.isArray(candidate.assetsRemoved)) {
    candidate.assetsRemoved = candidate.assetsRemoved
      .filter((url): url is string => typeof url === 'string')
      .map(sanitizeDeckVersionAssetUrl)
      .slice(0, 50)
  }

  const parsed = deckVersionDiffSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}
