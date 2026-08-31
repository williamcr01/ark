# Theme proposals

For a brand-new deck (empty workspace), after any `ask_user` context round and before `write_deck`:

1. Call `propose_themes` with exactly **4** visually distinct directions.
2. Each theme must include a lean, self-contained **single-slide** `sampleHtml` of the deck's real title slide in that look (inline CSS, registry fonts, no external URLs). Keep each sample under ~10 KiB.
3. Vary palette, typography, and layout density so the options feel meaningfully different, not four near-identical tweaks. A theme's font pairing is part of the theme: set the `data-ark-font-*` markers and `--ark-font-*` variables in each `sampleHtml`, and carry the picked theme's pairing into the full deck unchanged.
4. Every `sampleHtml` must already obey the best-practice rules (contrast, type scale, anti-slop). No purple/indigo default kits, pill clusters, or low-contrast demos.
5. Stop and wait. After the user picks a theme, build the full deck with `write_deck` in that direction. Do not re-propose themes unless the user explicitly asks for new options.

For an existing deck, call `propose_themes` only when the user explicitly asks to retheme the whole deck or requests new theme options. Base the samples on the deck's real content. After the user picks, apply that direction consistently across every slide while preserving the deck's content and structure unless they requested broader changes.
