# Theme proposals

For a brand-new or blank deck, ask the user directly in the Claude or Codex conversation for any critical missing context before writing:

1. Confirm the audience, approximate slide count, content priorities, and whether the deck should be concise, story-led, data-heavy, or visual when the request does not already make them clear.
2. Present exactly **4** visually distinct theme directions in the conversation.
3. Describe each direction's palette, typography, and layout density so the options feel meaningfully different — not four near-identical tweaks.
4. Stop and wait. After the user picks a theme, build the full deck with `write_deck` in that direction. Do not re-propose themes unless the user explicitly asks for new options.

For an existing deck, propose themes only when the user explicitly asks to retheme the whole deck or requests new theme options. Base the directions on the deck's real content. After the user picks, apply that direction consistently across every slide while preserving the deck's content and structure unless they requested broader changes.
