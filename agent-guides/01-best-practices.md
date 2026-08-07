# Best practices

Quick rules for readable, presentation-grade decks. Follow these on every write and patch.

## Editing workflow

- Inspect the current deck before editing and prefer targeted patches over full rewrites.
- Preserve an existing theme unless the user asks to retheme; apply visual changes consistently across all slides.

## Contrast and color

- Never use light text on a light background, or dark text on a dark background.
- Text and icons must clearly separate from their background (aim for WCAG AA: ~4.5:1 body, ~3:1 large titles). Prefer stronger contrast for small labels and projection.
- Do not place text on busy photos or loud gradients without a solid or heavily dimmed scrim.
- Limit the palette to about five roles: background, primary text, muted text, and one or two accents.
- Use accent color sparingly (titles, key numbers, CTAs), not every bullet or border.
- Do not convey meaning with color alone; pair with labels, icons, or patterns (especially red vs green).
- Prefer near-black / off-white over pure `#000` / `#fff` as the only pairing.
- Reject gray-on-color and low-saturation pastel-on-pastel combinations that fail a quick squint test.

## Typography

- Enforce a clear size/weight ladder: title ≫ subtitle ≫ body ≫ caption.
- Body text must be readable at a glance (roughly >=18-20px on a 16:9 full-bleed slide); titles much larger.
- Use at most two typefaces, or one family with two to three weights. Do not invent a new font per slide.
- Prefer screen-readable system font stacks. Avoid script or decorative faces for body copy.
- Left-align multi-line body text. Center only short headlines.
- Do not justify body text.
- Use line-height about 1.2-1.5 for body; avoid cramped 1.0 or overly airy 2.0+.
- Keep line length roughly 40-70 characters; split content rather than wrapping a wall of text.
- Do not use gradient-clipped text for copy that must be read quickly.
- Reserve ALL CAPS for short labels, never long phrases.

## Layout and spacing

- One primary idea per slide.
- Keep consistent margins on all sides (~5-8% of slide width). Nothing important flush to the edge.
- Leave deliberate whitespace (~15-30% empty). Do not fill every gap.
- Align to a simple grid so edges and baselines line up across slides.
- Use a spacing scale (multiples of 8px such as 8/16/24/32). Avoid random one-off gaps.
- Group related items tightly; separate unrelated clusters.
- Do not nest cards inside cards or wrap every element in a bordered box.
- Keep title position and size consistent across content slides.
- Vary layout rhythm across the deck (title, statement, split, data, quote) instead of cloning one template on every slide.

## Content density

- Prefer short phrases over paragraphs. Slides support speech; they do not replace it.
- Bullets: about 3-5 items, parallel grammar, one line each when possible.
- If content only fits by shrinking type, split into two slides instead.
- No lorem ipsum or generic filler unless the user asked for placeholders.
- Every slide should pass a 3-second test: title and key message readable at a glance.
- One focal point per slide (headline, big number, or visual), not three competing heroes.
- Emphasize with size, weight, and space first; color second; decoration last.
- Bold at most a phrase or two per slide.

## Imagery and icons

- Images must earn their place (product, place, data, metaphor), not generic stock filler.
- Prefer inline SVG or `ark-asset:<id>` over decorative noise.
- Keep icons in one style family (same stroke weight and size). Do not casually mix emoji with outlined icon sets.
- Do not stretch or distort images; use a consistent crop and corner treatment.
- Avoid heavy drop shadows, neon glows, and glassmorphism unless the chosen theme explicitly needs them.

## Charts and data

- One chart answers one question. Remove chartjunk (extra gridlines, 3D, ornamental legends).
- Label series directly when possible instead of forcing legend scavenger hunts.
- Start bar/column baselines at zero unless clearly annotated otherwise.
- Keep chart titles, captions, and key annotations in source HTML so they stay editable.
- Make the numbers that matter larger than surrounding chrome.

## Anti-slop defaults to avoid

- Do not default to purple→indigo gradients (for example `#7c3aed` / `#6366f1`) as the deck's personality.
- Do not default every deck to dark slate with an indigo accent.
- Avoid the SaaS landing-page slide: hero plus three equal feature cards plus soft shadows, unless the content truly needs that structure.
- Pick a decisive palette for the topic (warm editorial, crisp mono, bold primary). Avoid timid gray+violet.
- Decorative blobs, mesh gradients, and glow orbs are not a visual idea by themselves.
- Do not sprinkle rounded "pill" badges, chips, or tag clusters (for example "New", "AI-powered", "Trusted by...") as fake polish. Use labels only when they carry real information the audience needs.
- Avoid em-dashes in slide copy. Prefer commas, periods, colons, or parentheses.

## Consistency, motion, and accessibility

- Reuse the same background treatment, type scale, margins, and accent usage from the first slide to the last.
- Section dividers share one pattern; content slides share another.
- Use motion with restraint. Most slides need none. Never require animation to understand the content.
- Assume projectors wash out color: overshoot contrast rather than undershoot.
- Do not bury critical information in tiny footnotes.
- Prefer semantic structure inside slides (`h1`/`h2`, lists, sections) even when styling is custom.
