# reveal.js

Prefer reveal.js for new decks unless the user asks for a plain deck or the content is a simple static slide sequence with no motion or nesting. Use vertical stacks, fragments, and reveal layout when they help; keep it professional and creative.

## Hard rules

- Markers on `<html>`: `data-ark-runtime="reveal"`, `data-ark-runtime-lib="reveal.js"`, `data-ark-runtime-version="5.1.0"`. Do **not** set `data-ark-deck="nav"` — Ark’s reveal adapter owns navigation.
- Structure: `.reveal > .slides > section` only — never `section.slide`. No `data-markdown` / `<textarea data-template>` (Markdown plugin unavailable).
- Include all required runtime CSS/JS URLs from the system prompt registry list. CDN reveal.js URLs are invalid even if the version matches.
- No deck-authored bridge/`postMessage` scripts, `Reveal.initialize(...)`, or reveal plugins (Markdown, Highlight, Notes). Inline `<script>` blocks are disallowed **except** Chart.js init when `data-ark-runtime-addon-lib="chart.js"` is set.
- Only `theme/white.css` is vendored — override look in the deck’s inline `<style>`; do not link other reveal themes (`black`, `night`, `moon`, etc.).
- Do not promise: shell-controlled fragment step-through, speaker-notes UI / `S` key overlay, timer / `autoSlide`, PDF export, or custom keyboard / hash / controls (adapter disables that surface).
- Transitions / controls / hash: rely on adapter defaults — do not configure via `Reveal.initialize()`.
- Fragments are still worth authoring for Present/keyboard later; shell nav does not step them. Thumbnails show all fragments visible.
- Backgrounds: `data-background-color`, `data-background-gradient`, `data-background-image` (self-contained assets only — see base rules).
- `data-auto-animate` on sections can animate matched `data-id` elements between slides; still omit `Reveal.initialize()`.

```html
<!doctype html>
<html
  lang="en"
  data-ark-runtime="reveal"
  data-ark-runtime-lib="reveal.js"
  data-ark-runtime-version="5.1.0"
>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reveal Deck</title>
    <!-- Required CSS/JS URLs from the system prompt registry section -->
    <style>
      /* deck-specific CSS — override theme/white.css here */
    </style>
  </head>
  <body>
    <div class="reveal">
      <div class="slides">
        <section><h1>Title</h1></section>
        <section><h2>Next slide</h2></section>
      </div>
    </div>
    <!-- Required reveal.js script URL from the registry section -->
  </body>
</html>
```

**Ark injects:** reveal navigation adapter (preview + Present), parent bridge (`ark:deck-goto` ↔ Reveal h/v), thumbnail rendering for approved reveal decks.

**You author:** markers, exact registry `<link>` / `<script>` tags, `.reveal > .slides > section` content.

## Slide structure & index

```html
<div class="reveal">
  <div class="slides">
    <section>Slide 1</section>
    <section>Slide 2</section>
    <!-- Vertical stack -->
    <section>
      <section>Vertical 1</section>
      <section>Vertical 2</section>
    </section>
  </div>
</div>
```

Ark uses a **flattened linear index**:

- Top-level horizontal `<section>` without nested sections = one index.
- Horizontal section with vertical children = one index per vertical child (parent stack is not its own index).
- Fragment steps are **not** slide indices.

## Fragments

```html
<section>
  <h2>Agenda</h2>
  <ol>
    <li class="fragment">Appears first</li>
    <li class="fragment fade-up">Then this</li>
    <li class="fragment highlight-current-red">Emphasize</li>
  </ol>
</section>
```

Useful classes: `fade-in`, `fade-out`, `fade-up`, `fade-down`, `fade-left`, `fade-right`, `fade-in-then-out`, `highlight-red`, `highlight-blue`, `highlight-green`, `highlight-current-red`, `strike`.

## Code blocks

No Highlight plugin — plain HTML + deck CSS:

```html
<section>
  <h3>Resource naming</h3>
  <pre><code data-trim>
GET /users
GET /users/123
POST /users
  </code></pre>
</section>
```

Style `<pre>` / `<code>` in the deck’s inline `<style>`. `data-line-numbers` and highlight themes need Highlight — unsupported; do without.

## Speaker notes

```html
<section>
  <h2>Slide title</h2>
  <p>On-slide content</p>
  <aside class="notes">Talking points for the presenter.</aside>
</section>
```

Ark can parse notes; no speaker-notes UI in preview yet — still include when the user asks.
