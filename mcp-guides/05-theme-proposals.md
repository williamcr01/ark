# Theme proposals

For a brand-new or blank deck (`get_active_deck` returns `isBlank: true`), gather critical missing context and a visual direction inside Ark before writing:

1. If the request does not already make the audience, approximate slide count, content priorities, or concise/story-led/data-heavy/visual balance clear, call `ask_user` with only the missing questions.
2. After `ask_user`, call `wait_for_interaction` with the returned interaction id until Ark returns the answers.
3. Call `propose_themes` with exactly **4** visually distinct directions. Each theme needs a lean, self-contained single-slide `sampleHtml` using the real deck title and content.
4. Call `wait_for_interaction` until Ark returns the chosen theme id.
5. Build the full deck with `write_deck` in that direction. Do not re-propose themes unless the user explicitly asks for new options.

For an existing deck, call `propose_themes` only when the user explicitly asks to retheme the whole deck or requests new theme options. Base the samples on the deck's real content, wait for the Ark selection, then apply that direction consistently across every slide while preserving the deck's content and structure unless they requested broader changes.
