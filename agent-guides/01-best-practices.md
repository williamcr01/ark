# Best practices

Quick rules for readable, presentation-grade decks. Follow these on every write and patch.

## Self-check before write_deck or a large patch

1. One idea per slide; title and takeaway readable in about 3 seconds.
2. Strong contrast (no light-on-light or dark-on-dark); accents used sparingly.
3. Shared type scale, margins, and CSS theme tokens across slides.
4. No anti-slop defaults (purple/indigo kits, pill clusters, fake feature cards, em-dashes).
5. Narrative order makes sense: open, context, points, evidence, close.

## Editing workflow

- Inspect the current deck before editing and prefer targeted patches over full rewrites.
- Preserve an existing theme unless the user asks to retheme; apply visual changes consistently across all slides.
- Define theme tokens once in `:root` or `body` (for example `--bg`, `--text`, `--muted`, `--accent`) and reuse them in slide CSS so patches stay consistent.

## Contrast and color

- Never use light text on a light background, or dark text on a dark background.
- Text and icons must clearly separate from their background (aim for WCAG AA: ~4.5:1 body, ~3:1 large titles). Prefer stronger contrast for small labels and projection.
- Do not place text on busy photos or loud gradients without a solid or heavily dimmed scrim.
- Limit the palette to about five roles: background, primary text, muted text, and one or two accents.
- Use accent color sparingly (titles, key numbers, CTAs), not every bullet or border.
- Do not convey meaning with color alone; pair with labels, icons, or patterns (especially red vs green).
- Prefer near-black / off-white over pure `#000` / `#fff` as the only pairing.
- Reject gray-on-color and low-saturation pastel-on-pastel combinations that fail a quick squint test.
- Avoid ultra-thin light gray text; projectors and exports wash it out.

## Typography

- Enforce a clear size/weight ladder: title ≫ subtitle ≫ body ≫ caption.
- Minimum sizes on a 16:9 full-bleed slide: body >=20px, captions/labels >=14px, titles much larger.
- Pick fonts only from the approved registry listed in the system prompt, and declare them once with `data-ark-font-*` markers on `<html>`. Never write a raw `font-family` on an element; always use `var(--ark-font-display)`, `var(--ark-font-body)`, or `var(--ark-font-mono)`.
- Use at most two families across a deck (typically one display, one body; a third only for code). Do not invent a new font per slide. Personality comes from scale, weight, and palette.
- Prefer weights 400 and 700. Other weights render fine in the deck but collapse to the nearer of the two when the deck is exported to PowerPoint, so do not let a design depend on 300 or 600 to carry a distinction.
- Avoid script or decorative faces for body copy.
- Left-align multi-line body text. Center only short headlines. Do not center large body blocks or long lists.
- Do not justify body text.
- Use line-height about 1.2-1.5 for body; avoid cramped 1.0 or overly airy 2.0+.
- Keep line length roughly 40-70 characters; split content rather than wrapping a wall of text.
- Do not use gradient-clipped text for copy that must be read quickly.
- Reserve ALL CAPS for short labels, never long phrases.

## Layout and spacing

- One primary idea per slide. A single strong statement is valid; do not pad with fake cards.
- Keep consistent margins on all sides (~5-8% of slide width). Nothing important flush to the edge.
- Keep critical content out of the very bottom edge (Present chrome and UI can compete there).
- Leave deliberate whitespace (~15-30% empty). Do not fill every gap.
- Align to a simple grid so edges and baselines line up across slides.
- Use a spacing scale (multiples of 8px such as 8/16/24/32). Avoid random one-off gaps.
- Group related items tightly; separate unrelated clusters.
- Put the takeaway where eyes land first (usually top-left or a clear center headline), then supporting detail.
- Do not nest cards inside cards or wrap every element in a bordered box.
- Keep title position and size consistent across content slides.
- Vary layout rhythm across the deck (title, statement, split, data, quote) instead of cloning one template on every slide.
- Comparison / before-after slides: shared baseline, aligned columns, same scale.

## Narrative and copy

- Prefer a clear arc: title -> context -> a few points -> evidence -> close or CTA. Do not shuffle slides randomly.
- Use short agenda or section-divider slides when the deck is long; keep divider copy to a few words and reuse one divider pattern.
- Prefer short phrases over paragraphs. Slides support speech; they do not replace it.
- Bullets: about 3-5 items, parallel grammar, one line each when possible.
- If content only fits by shrinking type, split into two slides instead.
- No lorem ipsum or generic filler unless the user asked for placeholders.
- Write in active voice with concrete nouns. Avoid buzzword salad ("leverage", "synergy", "unlock", "revolutionize").
- Every slide should pass a 3-second test: title and key message readable at a glance.
- One focal point per slide (headline, big number, or visual), not three competing heroes.
- Emphasize with size, weight, and space first; color second; decoration last.
- Bold at most a phrase or two per slide.
- Quotes / callouts: at most one per slide; large quote type; smaller attribution.
- Prefer charts or key-value callouts over dense tables. If a table is needed: few columns, large type, no spreadsheet dumps.

## Imagery and icons

- Images must earn their place (product, place, data, metaphor), not generic stock filler.
- Prefer inline SVG or `ark-asset:<id>` over decorative noise.
- Prefer real HTML text and CSS/SVG shapes over text drawn as paths so content stays editable.
- Keep icons in one style family (same stroke weight and size). Do not casually mix emoji with outlined icon sets.
- Do not stretch or distort images; use a consistent crop and corner treatment.
- Logos sit in a corner and stay small. Do not invent fake brand marks.
- Avoid heavy drop shadows, neon glows, and glassmorphism unless the chosen theme explicitly needs them.

## Charts and data

Visual rules only; Chart.js mechanics live in the Chart.js guide.

- One chart answers one question. Remove chartjunk (extra gridlines, 3D, ornamental legends).
- Label series directly when possible instead of forcing legend scavenger hunts.
- Start bar/column baselines at zero unless clearly annotated otherwise.
- Keep chart titles, captions, and key annotations in source HTML so they stay editable.
- Make the numbers that matter larger than surrounding chrome.
- Include units and time frame. Round for slides when precision is not the point (for example 12.4% -> ~12%).

## Anti-slop defaults to avoid

- Do not default to purple->indigo gradients (for example `#7c3aed` / `#6366f1`) as the deck's personality.
- Do not default every deck to dark slate with an indigo accent.
- Avoid the SaaS landing-page slide: hero plus three equal feature cards plus soft shadows, unless the content truly needs that structure.
- Pick a decisive palette for the topic (warm editorial, crisp mono, bold primary). Avoid timid gray+violet.
- Decorative blobs, mesh gradients, and glow orbs are not a visual idea by themselves.
- Do not sprinkle rounded "pill" badges, chips, or tag clusters (for example "New", "AI-powered", "Trusted by...") as fake polish. Use labels only when they carry real information the audience needs.
- Avoid em-dashes in slide copy. Prefer commas, periods, colons, or parentheses.
- Avoid curly/smart quotes and ellipsis characters in slide copy. Use straight `"` / `'` and `...`.

## Consistency, motion, and accessibility

- Reuse the same background treatment, type scale, margins, and accent usage from the first slide to the last.
- Section dividers share one pattern; content slides share another.
- Use motion with restraint. Most slides need none. Never require animation or hover to understand the content.
- For reveal decks, prefer few fragments; do not staircase every bullet unless the user asks.
- Assume projectors wash out color: overshoot contrast rather than undershoot.
- Do not bury critical information in tiny footnotes.
- Prefer semantic structure inside slides (`h1`/`h2`, lists, sections) even when styling is custom.
- Keep `lang` on `<html>` and meaningful `alt` on informative images; mark decorative images appropriately.
