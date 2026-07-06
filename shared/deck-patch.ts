import { z } from 'zod'

import { ARK_ELEMENT_ID_ATTR, ARK_SLIDE_ID_ATTR } from './deck-metadata.ts'

export { ARK_ELEMENT_ID_ATTR, ARK_SLIDE_ID_ATTR }

export type DeckSlideTarget = {
  slideIndex?: number
  slideId?: string
}

const slideTargetFields = {
  slideIndex: z.number().int().min(0).optional().describe('Zero-based slide index.'),
  slideId: z.string().min(1).optional().describe('Stable slide id from data-ark-slide-id.'),
}

function slideTargetOperationSchema<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...slideTargetFields, ...shape }).superRefine((value, context) => {
    const target = value as DeckSlideTarget

    if (target.slideIndex === undefined && !target.slideId) {
      context.addIssue({
        code: 'custom',
        message: 'Provide slideIndex or slideId.',
        path: ['slideIndex'],
      })
    }
  })
}

export const deckSlidePatchOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_slide'),
    afterIndex: z
      .number()
      .int()
      .min(-1)
      .optional()
      .describe('Insert after this index. Omit or -1 to append.'),
    html: z.string().min(1).describe('Slide HTML (section outerHTML or inner content).'),
    slideId: z.string().min(1).optional().describe('Optional stable slide id to assign.'),
  }),
  slideTargetOperationSchema({ op: z.literal('delete_slide') }),
  slideTargetOperationSchema({
    op: z.literal('replace_slide'),
    html: z.string().min(1).describe('Replacement slide HTML.'),
  }),
  slideTargetOperationSchema({
    op: z.literal('reorder_slide'),
    toIndex: z.number().int().min(0).describe('Destination index after the move.'),
  }),
  slideTargetOperationSchema({
    op: z.literal('update_slide_title'),
    title: z.string().min(1).describe('New slide title.'),
  }),
  slideTargetOperationSchema({
    op: z.literal('update_slide_notes'),
    notes: z.string().describe('Speaker notes. Empty string clears notes.'),
  }),
])

/**
 * Element-level operations for the manual editor (issue #77).
 * Schema is defined here so frontend and backend share one contract.
 */
export const deckElementPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('replace_text'),
    slideIndex: z.number().int().min(0).optional(),
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1),
    text: z.string(),
  }),
  z.object({
    op: z.literal('insert_element'),
    slideIndex: z.number().int().min(0).optional(),
    slideId: z.string().min(1).optional(),
    html: z.string().min(1),
    afterElementId: z.string().min(1).optional(),
  }),
  z.object({
    op: z.literal('delete_element'),
    slideIndex: z.number().int().min(0).optional(),
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1),
  }),
  z.object({
    op: z.literal('set_attrs'),
    slideIndex: z.number().int().min(0).optional(),
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1),
    attrs: z.record(z.string(), z.string()),
  }),
  z.object({
    op: z.literal('set_inline_style'),
    slideIndex: z.number().int().min(0).optional(),
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1),
    style: z.record(z.string(), z.string()),
  }),
  z.object({
    op: z.literal('move_element'),
    slideIndex: z.number().int().min(0).optional(),
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    op: z.literal('resize_element'),
    slideIndex: z.number().int().min(0).optional(),
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1),
    width: z.number(),
    height: z.number(),
  }),
  z.object({
    op: z.literal('reorder_element'),
    slideIndex: z.number().int().min(0).optional(),
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1),
    zIndex: z.number().int(),
  }),
  z.object({
    op: z.literal('lock_element'),
    slideIndex: z.number().int().min(0).optional(),
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1),
  }),
  z.object({
    op: z.literal('unlock_element'),
    slideIndex: z.number().int().min(0).optional(),
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1),
  }),
])

export const deckTextReplacePatchOperationSchema = z.object({
  op: z.literal('text_replace'),
  oldText: z.string().min(1),
  newText: z.string(),
})

export const deckPatchOperationSchema = z.union([
  deckSlidePatchOperationSchema,
  deckElementPatchOperationSchema,
  deckTextReplacePatchOperationSchema,
])

export const deckPatchRequestSchema = z.object({
  operations: z.array(deckPatchOperationSchema).min(1).max(20),
  activeSlideIndex: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Current active slide index so the server can suggest an updated index.'),
})

export type DeckSlidePatchOperation = z.infer<typeof deckSlidePatchOperationSchema>
export type DeckElementPatchOperation = z.infer<typeof deckElementPatchOperationSchema>
export type DeckTextReplacePatchOperation = z.infer<typeof deckTextReplacePatchOperationSchema>
export type DeckPatchOperation = z.infer<typeof deckPatchOperationSchema>
export type DeckPatchRequest = z.infer<typeof deckPatchRequestSchema>

export type DeckPatchSuccess = {
  ok: true
  html: string
  changedSlideIndexes: number[]
  changedElementIds: string[]
  summary: string
  suggestedActiveSlideIndex?: number
  appliedCount: number
}

export type DeckPatchFailure = {
  ok: false
  error: string
  operationIndex?: number
}

export type DeckPatchResult = DeckPatchSuccess | DeckPatchFailure

const SLIDE_PATCH_OPS = new Set<DeckSlidePatchOperation['op']>([
  'add_slide',
  'delete_slide',
  'replace_slide',
  'reorder_slide',
  'update_slide_title',
  'update_slide_notes',
])

const ELEMENT_PATCH_OPS = new Set<DeckElementPatchOperation['op']>([
  'replace_text',
  'insert_element',
  'delete_element',
  'set_attrs',
  'set_inline_style',
  'move_element',
  'resize_element',
  'reorder_element',
  'lock_element',
  'unlock_element',
])

export function isSlidePatchOperation(
  operation: DeckPatchOperation,
): operation is DeckSlidePatchOperation {
  return SLIDE_PATCH_OPS.has(operation.op as DeckSlidePatchOperation['op'])
}

export function isElementPatchOperation(
  operation: DeckPatchOperation,
): operation is DeckElementPatchOperation {
  return ELEMENT_PATCH_OPS.has(operation.op as DeckElementPatchOperation['op'])
}

export function isTextReplacePatchOperation(
  operation: DeckPatchOperation,
): operation is DeckTextReplacePatchOperation {
  return operation.op === 'text_replace'
}

export function summarizePatchOperation(operation: DeckPatchOperation): string {
  switch (operation.op) {
    case 'add_slide':
      return `add slide${operation.afterIndex !== undefined ? ` after ${operation.afterIndex}` : ''}`
    case 'delete_slide':
      return `delete slide ${formatSlideTarget(operation)}`
    case 'replace_slide':
      return `replace slide ${formatSlideTarget(operation)}`
    case 'reorder_slide':
      return `move slide ${formatSlideTarget(operation)} to ${operation.toIndex}`
    case 'update_slide_title':
      return `rename slide ${formatSlideTarget(operation)}`
    case 'update_slide_notes':
      return `update notes on slide ${formatSlideTarget(operation)}`
    case 'text_replace':
      return 'text replace'
    case 'replace_text':
      return `replace text on ${operation.elementId}`
    case 'insert_element':
      return 'insert element'
    case 'delete_element':
      return `delete ${operation.elementId}`
    case 'set_attrs':
      return `set attrs on ${operation.elementId}`
    case 'set_inline_style':
      return `set style on ${operation.elementId}`
    case 'move_element':
      return `move ${operation.elementId}`
    case 'resize_element':
      return `resize ${operation.elementId}`
    case 'reorder_element':
      return `reorder ${operation.elementId}`
    case 'lock_element':
      return `lock ${operation.elementId}`
    case 'unlock_element':
      return `unlock ${operation.elementId}`
    default:
      return 'patch'
  }
}

export function summarizeDeckPatchResult(result: DeckPatchSuccess): string {
  const slides =
    result.changedSlideIndexes.length > 0
      ? `slides ${result.changedSlideIndexes.join(', ')}`
      : 'no slide index changes'
  return `Applied ${result.appliedCount} operation(s); ${slides}. ${result.summary}`
}

function formatSlideTarget(target: DeckSlideTarget) {
  if (target.slideId) {
    return target.slideId
  }

  return String(target.slideIndex)
}
