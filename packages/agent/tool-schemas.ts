/**
 * Input schemas for the deck tools. The agent loop and the MCP server expose the same
 * tools, so the schemas live here and `@ark/mcp` builds its catalog on top of them.
 */

import { z } from 'zod'

import {
  deckElementPatchOperationSchema,
  deckSlidePatchOperationSchema,
} from '@ark/deck/patch/patch-request.ts'

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
