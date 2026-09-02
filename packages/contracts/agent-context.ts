import { z } from 'zod'

import { editorSelectionFieldsSlideIndex } from '@ark/chat/context.ts'
import { themeFontPairingSchema } from '@ark/chat/agent-themes.ts'
import { deckThemeSpecV1Schema } from '@ark/deck/document/theme.ts'

/**
 * Manual-editor selection context (issue #83). Sent when the user has an element
 * selected so the agent can target "this" element by id and prefer id-based
 * patches over brittle full-document rewrites.
 */
export const editorSelectionContextSchema = z.object({
  slideIndex: z.number().int().min(0),
  slideId: z.string().min(1).optional(),
  elementId: z.string().min(1),
  elementKind: z.string().min(1).max(64).optional(),
  elementRole: z.string().min(1).max(64).optional(),
  textPreview: z.string().max(280).optional(),
  locked: z.boolean().optional(),
  managed: z.boolean().optional(),
})

export type EditorSelectionContext = z.infer<typeof editorSelectionContextSchema>

/** Max slides a user can attach as generation / chat context in one request. */
export const MAX_SLIDE_CONTEXTS = 64

/** Max elements in one same-slide editor multi-select (issue #248). */
export const MAX_EDITOR_SELECTIONS = 32

/**
 * Slide(s) the user attached as chat context so the agent can focus reads/edits
 * on those slides (e.g. "update this slide").
 */
export const slideContextSchema = z.object({
  slideIndex: z.number().int().min(0),
  slideId: z.string().min(1).optional(),
  title: z.string().min(1).max(200).optional(),
})

export type SlideContext = z.infer<typeof slideContextSchema>

export const editorSelectionsSchema = z
  .array(editorSelectionContextSchema)
  .max(MAX_EDITOR_SELECTIONS)

type EditorSelectionFields = {
  editorSelection?: EditorSelectionContext
  editorSelections?: EditorSelectionContext[]
}

/**
 * Drop extras that are not on the authoritative slide. Used for persisted /
 * replayed per-message context so a mixed stored turn cannot 400 the whole chat.
 */
export function stripCrossSlideEditorSelectionFields<T extends EditorSelectionFields>(value: T): T {
  const slideIndex = editorSelectionFieldsSlideIndex(value)
  if (slideIndex === undefined) return value

  const next: EditorSelectionFields = {}
  if (value.editorSelection && value.editorSelection.slideIndex === slideIndex) {
    next.editorSelection = value.editorSelection
  }
  if (value.editorSelections?.length) {
    const editorSelections = value.editorSelections.filter((item) => item.slideIndex === slideIndex)
    if (editorSelections.length > 0) next.editorSelections = editorSelections
  }

  const rest = { ...value }
  delete rest.editorSelection
  delete rest.editorSelections
  return { ...rest, ...next }
}

/**
 * Same-slide v1 for *top-level* generation-job fields: reject mixed slideIndex
 * rather than inventing cross-slide multi-select. Also reject a distinct 33rd
 * primary when the array is already at the cap, so a user-selected id is never
 * dropped with no signal.
 */
export function refineSameSlideEditorSelectionFields(
  value: EditorSelectionFields,
  ctx: z.RefinementCtx,
) {
  const selections = value.editorSelections ?? []
  if (selections.length === 0) {
    return
  }

  const slideIndex = editorSelectionFieldsSlideIndex(value)
  if (slideIndex === undefined) return

  if (selections.some((item) => item.slideIndex !== slideIndex)) {
    ctx.addIssue({
      code: 'custom',
      path: ['editorSelections'],
      message: 'editorSelections must share a single slideIndex (same-slide multi-select only).',
    })
  }

  if (value.editorSelection && value.editorSelection.slideIndex !== slideIndex) {
    ctx.addIssue({
      code: 'custom',
      path: ['editorSelection', 'slideIndex'],
      message:
        'editorSelection.slideIndex must match editorSelections (same-slide multi-select only).',
    })
  }

  if (
    value.editorSelection &&
    value.editorSelection.slideIndex === slideIndex &&
    selections.length >= MAX_EDITOR_SELECTIONS &&
    !selections.some((item) => item.elementId === value.editorSelection!.elementId)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['editorSelection'],
      message: `editorSelection would exceed the ${MAX_EDITOR_SELECTIONS} element cap.`,
    })
  }
}

export const themeSelectionContextSchema = z.object({
  themeId: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  fonts: themeFontPairingSchema,
  theme: deckThemeSpecV1Schema,
})

export type ThemeSelectionContext = z.infer<typeof themeSelectionContextSchema>

/** Optional context attached to a user chat turn (composer + persisted history). */
export const chatMessageContextSchema = z
  .object({
    editorSelection: editorSelectionContextSchema.optional(),
    editorSelections: editorSelectionsSchema.optional(),
    slideContexts: z.array(slideContextSchema).max(MAX_SLIDE_CONTEXTS).optional(),
    themeSelection: themeSelectionContextSchema.optional(),
  })
  .transform((value) => stripCrossSlideEditorSelectionFields(value))

export type ChatMessageContext = z.infer<typeof chatMessageContextSchema>
