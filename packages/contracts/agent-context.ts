import { z } from 'zod'

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

/** Same-slide v1: reject mixed slideIndex values rather than inventing cross-slide multi-select. */
export function refineSameSlideEditorSelectionFields(
  value: EditorSelectionFields,
  ctx: z.RefinementCtx,
) {
  const selections = value.editorSelections ?? []
  if (selections.length === 0) {
    return
  }

  const slideIndex = selections[0]!.slideIndex
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
}

/** Optional context attached to a user chat turn (composer + persisted history). */
export const chatMessageContextSchema = z
  .object({
    editorSelection: editorSelectionContextSchema.optional(),
    editorSelections: editorSelectionsSchema.optional(),
    slideContexts: z.array(slideContextSchema).max(MAX_SLIDE_CONTEXTS).optional(),
  })
  .superRefine(refineSameSlideEditorSelectionFields)

export type ChatMessageContext = z.infer<typeof chatMessageContextSchema>
