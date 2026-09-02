import { z } from 'zod'

export {
  deckEditInputSchema,
  deckElementPatchInputSchema,
  deckReadInputSchema,
  deckSlidePatchInputSchema,
  deckWriteInputSchema,
} from '@ark/agent/tool-schemas.ts'

import {
  deckEditInputSchema,
  deckElementPatchInputSchema,
  deckReadInputSchema,
  deckSlidePatchInputSchema,
  deckWriteInputSchema,
} from '@ark/agent/tool-schemas.ts'

import { agentQuestionRequestSchema } from '@ark/chat/agent-questions.ts'
import { themeProposalRequestObjectSchema } from '@ark/chat/agent-themes.ts'

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

export const MCP_SERVER_INSTRUCTIONS =
  'Before the first Ark deck edit in each conversation, call get_authoring_guide once, then get_active_deck. When isBlank is true, use ask_user for critical missing context, then propose_themes with exactly four visual samples (full theme spec plus three-slide HTML); after either call, use wait_for_interaction until Ark returns the user response. Build the chosen contract with write_deck, embedding the spec as data-ark-theme JSON and classifying every slide. For authored decks, call parse_deck or list_slides and prefer patch_deck; use edit_deck for small exact edits and write_deck only for explicit full rewrites. Carry deckId and documentRevision from reads into writes. Produce one self-contained HTML document with no external resource URLs. Use only approved /api/runtimes/... assets and existing Ark asset URLs. After a revision conflict, re-read and retry.'

export const MCP_TOOL_CATALOG = {
  get_authoring_guide: {
    description:
      'Return Ark deck authoring rules and approved runtime guidance. Call once before the first edit in each conversation.',
    inputSchema: z.object({}),
    mutating: false,
  },
  get_active_deck: {
    description:
      'Return the visible Ark deck, its revision, title, slide count, origin, and whether it is blank.',
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
    description: 'Replace the entire deck. Use for a blank deck or an explicit full rewrite.',
    inputSchema: mutationTargetSchema.extend(deckWriteInputSchema.shape),
    mutating: true,
  },
  ask_user: {
    description:
      'Show up to five concise questions inside Ark when critical context is missing. Returns an interaction id; call wait_for_interaction until the user responds.',
    inputSchema: mutationTargetSchema.extend(agentQuestionRequestSchema.shape),
    mutating: false,
    sideEffecting: true,
  },
  propose_themes: {
    description:
      'Show exactly four visual theme samples inside Ark. Each theme must include a full theme spec (fonts, colors, type, spacing, slide recipes), a rationale, and a three-slide sampleHtml using --ark-* variables. Returns an interaction id; call wait_for_interaction until the user picks one or asks for different options.',
    inputSchema: mutationTargetSchema.extend(themeProposalRequestObjectSchema.shape),
    mutating: false,
    sideEffecting: true,
  },
  wait_for_interaction: {
    description:
      'Wait briefly for the user to answer an Ark question or theme picker. Call again while status is pending.',
    inputSchema: z.object({
      interactionId: z.string().uuid(),
      timeoutMs: z.number().int().min(0).max(20_000).optional(),
    }),
    mutating: false,
  },
} as const

export type McpToolName = keyof typeof MCP_TOOL_CATALOG

export const mcpToolNameSchema = z.enum(
  Object.keys(MCP_TOOL_CATALOG) as [McpToolName, ...McpToolName[]],
)

export function isMcpToolName(name: string): name is McpToolName {
  return name in MCP_TOOL_CATALOG
}
