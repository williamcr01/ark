# Base rules

Hard requirements and defaults for every deck.

## Hard requirements for deck HTML

- Include `<!DOCTYPE html>`, `<html>`, `<head>`, and `<body>`.
- Use inline CSS inside a `<style>` tag. No Tailwind, npm packages, or build tooling.
- Decks must be fully self-contained: no http(s) URLs for scripts, stylesheets, fonts, or images.
- Use inline CSS, system fonts, inline SVG, or `data:` URIs instead of external assets.
- Design for 16:9: `html`/`body` width 100%, height 100%, margin 0, overflow hidden; active slide fills 100vw × 100vh.
- Keep copy concise and presentation-grade. Avoid lorem ipsum and generic filler.

External JavaScript libraries are only acceptable if inlined in the HTML or served via approved runtime URLs from the system prompt registry section — never CDN script URLs.

## Plain deck structure

When the user wants a plain deck (or a simple static sequence):

- Each slide is a top-level `<section class="slide">`. All slides in the DOM at once. No runtime markers; Ark injects CSS-only navigation.

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

## Preview modes

- **Plain CSS (default):** no marker — Ark injects navigation; deck scripts are stripped.
- **Custom full-JS:** set `data-ark-deck="nav"` on `<html>` when the deck owns navigation.
- **Reveal:** use the reveal.js guide + registry markers/assets; Ark injects the reveal adapter (do not add a custom bridge).

### Custom full-JS bridge protocol

When using `data-ark-deck="nav"`:

- Listen for `CustomEvent` `"ark:deck-goto"` with `detail.index` from the Ark bridge.
- Dispatch `CustomEvent` `"ark:deck-slide-change"` with `detail.index` on every slide change.
- Do **not** call `window.parent.postMessage` for navigation — use DOM events only; Ark's injected bridge forwards them.
