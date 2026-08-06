import { z } from 'zod'

import { deckElementPatchOperationSchema, deckSlidePatchOperationSchema } from './deck-patch.ts'

const targetSchema = z.object({
  deckId: z.string().uuid().optional().describe('Deck id returned by the latest read.'),
})

const mutationTargetSchema = z.object({
  deckId: z.string().uuid().describe('Deck id returned by the latest read.'),
  expectedDocumentRevision: z
    .number()
    .int()
    .min(1)
    .describe('Document revision returned by the latest read.'),
})

export const deckReadInputSchema = z.object({
  offset: z.number().int().min(1).optional().describe('1-based line number to start at.'),
  limit: z.number().int().min(1).optional().describe('Maximum lines to return.'),
  slideIndex: z.number().int().min(0).optional().describe('Zero-based slide index.'),
  charOffset: z.number().int().min(0).optional().describe('Character continuation offset.'),
})

export const deckEditInputSchema = z.object({
  edits: z
    .array(
      z.object({
        oldText: z.string().min(1).describe('Exact text that appears exactly once.'),
        newText: z.string().describe('Replacement text.'),
      }),
    )
    .min(1)
    .max(20),
})

export const deckWriteInputSchema = z.object({
  html: z.string().min(1).describe('Complete self-contained HTML document.'),
})

export const deckSlidePatchInputSchema = z.object({
  operations: z.array(deckSlidePatchOperationSchema).min(1).max(20),
  activeSlideIndex: z.number().int().min(0).optional(),
})

export const deckElementPatchInputSchema = z.object({
  operations: z.array(deckElementPatchOperationSchema).min(1).max(20),
  activeSlideIndex: z.number().int().min(0).optional(),
})

export const MCP_SERVER_INSTRUCTIONS =
  'Call get_active_deck first, then parse_deck or list_slides before targeted edits. Prefer patch_deck; use edit_deck for small exact edits and write_deck only for explicit full rewrites. Carry deckId and documentRevision from reads into writes. Produce one self-contained HTML document with no external resource URLs. Use only approved /api/runtimes/... assets and existing Ark asset URLs. After a revision conflict, re-read and retry.'

export const MCP_TOOL_CATALOG = {
  get_active_deck: {
    description: 'Return the visible Ark deck, its revision, title, and slide count.',
    inputSchema: z.object({}),
    mutating: false,
  },
  parse_deck: {
    description:
      'Parse the visible deck into structured metadata, slides, notes, assets, and editable element ids.',
    inputSchema: targetSchema,
    mutating: false,
  },
  list_slides: {
    description: 'List slide ids, indexes, and titles in the visible deck.',
    inputSchema: targetSchema,
    mutating: false,
  },
  read_deck: {
    description: 'Read paged deck HTML or one slide. Re-read after conflicts.',
    inputSchema: targetSchema.extend(deckReadInputSchema.shape),
    mutating: false,
  },
  patch_deck: {
    description: 'Apply structured slide operations. Preferred for slide edits.',
    inputSchema: mutationTargetSchema.extend(deckSlidePatchInputSchema.shape),
    mutating: true,
  },
  patch_element: {
    description: 'Apply structured operations to stable editable element ids.',
    inputSchema: mutationTargetSchema.extend(deckElementPatchInputSchema.shape),
    mutating: true,
  },
  edit_deck: {
    description: 'Apply exact unique old-text to new-text edits.',
    inputSchema: mutationTargetSchema.extend(deckEditInputSchema.shape),
    mutating: true,
  },
  write_deck: {
    description: 'Replace the entire deck. Use only for an explicit full rewrite.',
    inputSchema: mutationTargetSchema.extend(deckWriteInputSchema.shape),
    mutating: true,
  },
} as const

export type McpToolName = keyof typeof MCP_TOOL_CATALOG

export const mcpToolNameSchema = z.enum(
  Object.keys(MCP_TOOL_CATALOG) as [McpToolName, ...McpToolName[]],
)

export function isMcpToolName(name: string): name is McpToolName {
  return name in MCP_TOOL_CATALOG
}
