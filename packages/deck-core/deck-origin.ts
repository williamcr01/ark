/**
 * How the deck's current content came to exist.
 *
 * Ark creates a deck the moment the user opens `/decks/new`, so "the deck has
 * HTML" cannot tell the agent whether it is looking at the user's work or at a
 * starter document nobody has touched. Origin records that intent explicitly.
 *
 * - `blank` — Ark's empty starter deck. No one has authored anything yet, so the
 *   agent opens a new-deck conversation (ask for missing context, propose themes)
 *   instead of treating the placeholder as something to revise.
 * - `authored` — the deck holds real content: generated, hand-edited, uploaded,
 *   or opened from a file. The agent edits in place.
 *
 * Adding a value (e.g. `template`) means: extend `DECK_ORIGINS`, decide what
 * `deckOriginIsUnauthored` should return for it, and give it a branch in
 * `wrapUserPromptForAgent`. Persistence needs no migration — the column stores
 * the string, and unknown values fall back to `DEFAULT_DECK_ORIGIN`.
 */
export const DECK_ORIGINS = ['blank', 'authored'] as const

export type DeckOrigin = (typeof DECK_ORIGINS)[number]

/**
 * Decks predating the origin column, and any deck created without an explicit
 * origin, hold content worth preserving — assume authored rather than blank.
 */
export const DEFAULT_DECK_ORIGIN: DeckOrigin = 'authored'

export function isDeckOrigin(value: unknown): value is DeckOrigin {
  return typeof value === 'string' && (DECK_ORIGINS as readonly string[]).includes(value)
}

export function normalizeDeckOrigin(value: unknown): DeckOrigin {
  return isDeckOrigin(value) ? value : DEFAULT_DECK_ORIGIN
}

/**
 * True when the deck's content is Ark's, not the user's, so the agent should
 * start a fresh deck conversation rather than revise what is already there.
 */
export function deckOriginIsUnauthored(origin: DeckOrigin | null | undefined) {
  return normalizeDeckOrigin(origin) === 'blank'
}

/**
 * Origin after a write lands. Authoring content — by agent, editor, or upload —
 * permanently retires the blank state; every other origin is already terminal.
 */
export function deckOriginAfterWrite(origin: DeckOrigin | null | undefined): DeckOrigin {
  return normalizeDeckOrigin(origin) === 'blank' ? 'authored' : normalizeDeckOrigin(origin)
}
