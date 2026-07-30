# Theme proposals (new decks)

For a brand-new deck (empty workspace), after any `ask_user` context round and before `write_deck`:

1. Call `propose_themes` with exactly **4** visually distinct directions.
2. Each theme must include a lean, self-contained **single-slide** `sampleHtml` of the deck's real title slide in that look (inline CSS, system fonts, no external URLs). Keep each sample under ~10 KiB.
3. Vary palette, typography, and layout density so the options feel meaningfully different — not four near-identical tweaks.
4. Stop and wait. After the user picks a theme, build the full deck with `write_deck` in that direction. Do not re-propose themes unless the user explicitly asks for new options.

Never call `propose_themes` when editing an existing deck.
