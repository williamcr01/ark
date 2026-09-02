# Theme proposals

For a brand-new deck (empty workspace), after any `ask_user` context round and before `write_deck`:

1. Call `propose_themes` with exactly **4** visually distinct directions.
2. Each theme must include a full `theme` spec (`fonts`, `colors`, `typography`, `spacing`, `slideRecipes` for cover/section/content/data/closing), a one-line `rationale`, and `fonts` matching `theme.fonts` using approved deck font ids (not CSS stacks).
3. `sampleHtml` is a lean, self-contained **three-slide** demonstration of that spec: cover, content, and one of section/data/closing based on the real content. Mark slides with `data-ark-slide-kind` and `data-ark-layout` matching the recipes. Use canonical `--ark-*` CSS variables (and `data-ark-font-*` markers) instead of unrelated hardcoded values. Inline CSS, registry fonts, no scripts, runtimes, or external URLs. Keep each sample under ~8 KiB.
4. Vary palette, typography, and layout recipes so the options feel meaningfully different, not four near-identical tweaks.
5. Every sample must already obey the best-practice rules (contrast, type scale, anti-slop). No purple/indigo default kits, pill clusters, or low-contrast demos.
6. Stop and wait. After the user picks a theme, build the full deck with `write_deck` from that exact contract: embed the spec as `<script type="application/json" data-ark-theme>`, materialize its CSS variables, set font markers, and classify every slide with `data-ark-slide-kind` and `data-ark-layout` matching the selected recipes. Do not re-propose themes unless the user explicitly asks for new options.

For an existing deck, call `propose_themes` only when the user explicitly asks to retheme the whole deck or requests new theme options. Base the samples on the deck's real content. After the user picks, apply that contract consistently across every slide while preserving the deck's content and structure unless they requested broader changes.
