# Base rules

Hard requirements and defaults for every deck.

- Include `<!DOCTYPE html>`, `<html>`, `<head>`, and `<body>`.
- Use inline CSS inside a `<style>` tag. No Tailwind, npm packages, or build tooling.
- Decks must be fully self-contained: no http(s) URLs for scripts, stylesheets, fonts, or images.
- Use inline CSS, system fonts, inline SVG, or `ark-asset:<id>` for known workspace assets. `data:` URIs are accepted and extracted into workspace assets when saved.
- Design for 16:9: `html`/`body` width 100%, height 100%, margin 0, overflow hidden; active slide fills 100vw × 100vh.
- Keep copy concise and presentation-grade. Avoid lorem ipsum and generic filler.

External JavaScript libraries are only acceptable if inlined in the HTML or served via approved runtime URLs from the system prompt registry section; never CDN script URLs.

## Manual-edit compatibility

- Keep user-visible text, images, inline SVG, and layout containers directly in the source HTML so Ark can select and persist edits to them.
- Use JavaScript for navigation and progressive enhancement. Do not replace, continuously re-render, or intercept pointer events on the primary slide content.
- Give important editable elements unique, stable `data-ark-id` values.
- Prefer HTML or inline SVG for visuals users may edit. Canvas pixels and DOM created only at runtime cannot map back to source HTML; keep chart titles, captions, and key annotations in source-backed HTML when using canvas.

## Plain deck structure

When the user wants a plain deck (or a simple static sequence):

- Each slide is a top-level `<section class="slide">`. All slides in the DOM at once. No runtime markers; Ark injects CSS-only navigation.
- Do **not** add a `<script>` for slide navigation. Ark already handles it, and preview strips deck scripts in this mode: a nav script is dead code that makes the preview show a "Static preview" notice. Ship plain decks with no `<script>` at all.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Deck Title</title>
    <style>
      /* deck styles */
    </style>
  </head>
  <body>
    <section class="slide">...</section>
    <section class="slide">...</section>
  </body>
</html>
```

### Custom full-JS bridge protocol

When using `data-ark-deck="nav"`:

- Listen for `CustomEvent` `"ark:deck-goto"` with `detail.index` from the Ark bridge.
- Dispatch `CustomEvent` `"ark:deck-slide-change"` with `detail.index` on every slide change.
- Dispatch `"ark:deck-slide-change"` only **after** the new slide is actually rendered in the DOM; never optimistically before the view updates. Ark's thumbnail capture trusts this event's index; an early event can capture the previous slide's pixels.
- Dispatch it exactly once per completed navigation; no duplicate or out-of-order events.
- Do **not** call `window.parent.postMessage` for navigation; use DOM events only; Ark's injected bridge forwards them.
