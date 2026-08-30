import { z } from 'zod'

/**
 * Ark's ids are v4 UUIDs. The pattern lives here because the deck id is the oldest and
 * most widely referenced of them; `@ark/chat` reuses it for generation job ids.
 */
export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const DECK_ID_PATTERN = UUID_V4_PATTERN

export const deckIdSchema = z.string().regex(UUID_V4_PATTERN, 'Invalid deck id.')

export function isValidDeckId(id: string) {
  return DECK_ID_PATTERN.test(id)
}
