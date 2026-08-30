import { z } from 'zod'

import { deckIdSchema } from '@ark/deck/document/id.ts'
import { DECK_ORIGINS } from '@ark/deck/document/origin.ts'

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
