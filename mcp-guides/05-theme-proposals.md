# Theme proposals

For a brand-new or blank deck (`get_active_deck` returns `isBlank: true`), gather critical missing context and a visual direction inside Ark before writing:

1. If the request does not already make the audience, approximate slide count, content priorities, or concise/story-led/data-heavy/visual balance clear, call `ask_user` with only the missing questions.
2. After `ask_user`, call `wait_for_interaction` with the returned interaction id until Ark returns the answers.
3. Call `propose_themes` with exactly **4** visually distinct directions. Each theme needs a full `theme` spec (fonts, colors, type, spacing, slide recipes), a rationale, `fonts` matching `theme.fonts` as approved deck font ids, and a lean three-slide `sampleHtml` (cover, content, and one of section/data/closing) using the real deck title and content plus `--ark-*` variables.
4. Every `sampleHtml` must already obey the best-practice rules (contrast, type scale, anti-slop). No purple/indigo default kits, pill clusters, or low-contrast demos.
5. Call `wait_for_interaction` until Ark returns the chosen theme contract (or a request for different options).
6. Build the full deck with `write_deck` from that exact contract: embed `<script type="application/json" data-ark-theme>`, materialize CSS variables, and classify every slide. Do not re-propose themes unless the user explicitly asks for new options.

For an existing deck, call `propose_themes` only when the user explicitly asks to retheme the whole deck or requests new theme options. Base the samples on the deck's real content, wait for the Ark selection, then apply that contract consistently across every slide while preserving the deck's content and structure unless they requested broader changes.
