# reveal.js runtime authoring

Ark supports [reveal.js](https://revealjs.com/) **5.1.0** through the approved runtime registry. Decks reference Ark-served assets and runtime markers; Ark handles preview navigation, Present mode, and sidebar thumbnails.

General registry rules: [runtimes.md](./runtimes.md). Bridge protocol: [deck-bridge.md](./deck-bridge.md).

## When to use reveal.js

- Use **plain Ark decks** (`section.slide` + inline CSS) by default — simpler, fully CSS-only preview, easy agent patching.
- Use **reveal.js** when the user asks for it or when reveal-specific layout/features (vertical stacks, fragments, reveal themes) are required.
- Do **not** use CDN URLs. Do **not** add reveal plugins unless they are vendored and listed in `runtimes/manifest.json` (none today).

## Supported version

| Field         | Value                                      |
| ------------- | ------------------------------------------ |
| Registry id   | `reveal.js`                                |
| Version       | `5.1.0`                                    |
| Source        | https://github.com/hakimel/reveal.js (MIT) |
| Vendored path | `runtimes/reveal.js/5.1.0/`                |

Only this version is approved. References to other versions (including `/api/runtimes/reveal.js/4.x/...`) fail validation.

## Required markers

Set on `<html>`:

```html
<html
  lang="en"
  data-ark-runtime="reveal"
  data-ark-runtime-lib="reveal.js"
  data-ark-runtime-version="5.1.0"
></html>
```

| Attribute                  | Required value | Notes                                             |
| -------------------------- | -------------- | ------------------------------------------------- |
| `data-ark-runtime`         | `reveal`       | Identifies reveal runtime family                  |
| `data-ark-runtime-lib`     | `reveal.js`    | Must match manifest `id`                          |
| `data-ark-runtime-version` | `5.1.0`        | Must match manifest `version` and every asset URL |

Alternate: `data-ark-deck="reveal"` also selects reveal mode, but **`data-ark-runtime-lib` and `data-ark-runtime-version` are still required** for validation and generation.

Do **not** set `data-ark-deck="nav"` on registry reveal decks — navigation is handled by Ark's reveal adapter.

## Required assets

These `<link>` and `<script>` URLs must appear in the deck (exact paths):

| Kind      | URL                                             |
| --------- | ----------------------------------------------- |
| Core CSS  | `/api/runtimes/reveal.js/5.1.0/reveal.css`      |
| Theme CSS | `/api/runtimes/reveal.js/5.1.0/theme/white.css` |
| Core JS   | `/api/runtimes/reveal.js/5.1.0/reveal.js`       |

The registry also ships optional assets (`reset.css`, Source Sans Pro font files). Only `white` theme CSS is vendored today — other reveal themes are **not supported** until added to the manifest.

## Minimal deck skeleton

Copy-paste starting point (also available as `test/fixtures/reveal-registry-deck.html`):

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
    <link rel="stylesheet" href="/api/runtimes/reveal.js/5.1.0/reveal.css" />
    <link rel="stylesheet" href="/api/runtimes/reveal.js/5.1.0/theme/white.css" />
    <style>
      /* deck-specific CSS only — keep overrides here */
    </style>
  </head>
  <body>
    <div class="reveal">
      <div class="slides">
        <section>
          <h1>Title</h1>
        </section>
        <section>
          <h2>Next slide</h2>
        </section>
      </div>
    </div>
    <script src="/api/runtimes/reveal.js/5.1.0/reveal.js"></script>
  </body>
</html>
```

No deck-authored bridge script is required. Ark injects the reveal navigation adapter in preview and Present mode.

### Deck-specific CSS

Keep presentation styling in an inline `<style>` block. Do not link external stylesheets except approved runtime URLs above.

## Slide structure

Standard reveal markup:

```html
<div class="reveal">
  <div class="slides">
    <section>Horizontal slide</section>
    <section>
      <section>Vertical child A</section>
      <section>Vertical child B</section>
    </section>
  </div>
</div>
```

### Slide index model

Ark uses a **flattened linear index** matching reveal's slide order:

- Each top-level horizontal `<section>` without nested sections = **one** slide index.
- A horizontal section with vertical children = **one index per vertical child** (the parent stack is not a separate index).
- **Fragment steps are not slide indices.** Fragment-only navigation does not update Ark's active slide.

The shell sends `ark:deck-goto` with a linear index; the reveal adapter maps it to `Reveal.slide(h, v, 0)`.

## Preview and Present mode

Approved reveal decks with all required markers and assets use **full-JS preview** via Ark's reveal adapter (`buildRevealNavRuntimeScript`):

- Preserves the approved `reveal.js` script tag
- Absolutizes `/api/runtimes/...` URLs to the app origin for sandbox fetch
- Initializes Reveal with preview-safe settings: `hash: false`, `keyboard: false`, `controls: false`, `progress: false`, `history: false`
- Maps parent `ark:deck-goto` → `Reveal.slide(h, v, 0)`
- Reports `ark:deck-slide-change` using Reveal's flattened index (`getSlidePastCount`)
- Announces `runtime: 'reveal'` in bridge metadata

Present mode uses the same processed HTML and bridge as main preview.

Reveal decks **without** approved registry assets fall back to **CSS-only** preview: scripts are stripped and the CSS navigation shim toggles static sections.

## Thumbnails

Sidebar thumbnails prefer **sandbox-rendered PNGs** produced by the headless
Electron capture pipeline ([thumbnails.md](./thumbnails.md)). That path loads the same
preview HTML / reveal adapter as main preview, so approved Reveal decks render
with runtime layout instead of a static approximation.

When the renderer is disabled, pending, failed, or an image fails to load, the
strip falls back to scriptless `srcDoc` iframes (`sandbox=""`). For that
fallback on approved reveal decks:

- Approved runtime CSS (`reveal.css`, linked theme) is **inlined** into each thumbnail `srcDoc`
- A layout shim (`data-ark-reveal-thumb-shim`) positions the selected slide
- Vertical stacks flatten to linear indices; each thumbnail shows one selected horizontal/vertical slide
- **All fragments on a slide are shown visible** in the thumbnail (no step-through)
- **`@font-face` rules are stripped** from inlined CSS; thumbnails use system font fallbacks
- Background attributes (e.g. `data-background-color`) are preserved

If runtime CSS cannot be loaded for inlining, fallback thumbnails use linked `/api/runtimes/...` URLs (requires network from thumbnail iframe context).

## Feature support matrix

Status as of issues [#93](https://github.com/williamcr01/ark/issues/93), [#94](https://github.com/williamcr01/ark/issues/94), and [#95](https://github.com/williamcr01/ark/issues/95):

| Feature            | Status                  | Notes                                                                                                                                                                                  |
| ------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Horizontal slides  | **Supported**           | Main preview, Present, thumbnails, shell navigation                                                                                                                                    |
| Vertical slides    | **Supported**           | Flattened to linear indices; preview navigates h/v correctly; thumbnails show selected vertical child                                                                                  |
| Fragments          | **Partially supported** | Thumbnails show all fragments visible; preview/Present do not advance fragment steps via shell nav — fragment-only reveal navigation does not update Ark slide index                   |
| Speaker notes      | **Partially supported** | Parser extracts `<aside class="notes">`, `data-notes`, and HTML comments; no speaker-notes UI in preview yet                                                                           |
| Themes             | **Partially supported** | Only `theme/white.css` is vendored; other reveal themes are not in the registry                                                                                                        |
| Backgrounds        | **Partially supported** | `data-background-color` and inline background attributes render in thumbnails; image/video backgrounds need inline or data URIs (no external URLs)                                     |
| Plugins            | **Not supported**       | No reveal plugins in registry; do not reference plugin scripts                                                                                                                         |
| Main preview       | **Supported**           | Full reveal adapter with approved assets                                                                                                                                               |
| Present mode       | **Supported**           | Same bridge and adapter as main preview                                                                                                                                                |
| Sidebar thumbnails | **Supported**           | Preferred path: sandbox-rendered PNGs via Electron ([thumbnails.md](./thumbnails.md)); `srcDoc` fallback remains static CSS with fragments fully visible                               |
| Export / download  | **Supported**           | **Original** download keeps deck source with `/api/runtimes/...` URLs; **sanitized** download strips non-approved scripts (approved reveal script preserved when using reveal adapter) |

## Security rules (reveal-specific)

- CDN reveal.js URLs (`https://cdn.jsdelivr.net/...`, `unpkg`, etc.) → **`external_url` / validation error**
- Runtime asset URLs must match `data-ark-runtime-version` exactly
- Do not add inline `<script>` blocks to registry reveal decks — `allowsDeckScripts: false`
- Do not rely on Reveal keyboard, URL hash, or controls in preview (disabled by adapter)
- External images/fonts in slide content remain blocked unless inline, SVG, or `data:` URIs

## Agent guidance

When generating or editing reveal decks, the agent should:

1. **Prefer plain decks** unless reveal.js is requested or necessary.
2. Set all three library markers on `<html>`.
3. Use **exact** required asset URLs from the table above — never CDN equivalents.
4. Use standard `.reveal > .slides > section` structure for patch-friendly edits.
5. Keep deck-specific rules in inline `<style>`.
6. Avoid reveal plugins, markdown plugin, PDF export, and other features not in the matrix.
7. Do not promise fragment step-through or speaker-notes UI in the shell.
8. Do not add custom bridge scripts — Ark injects the reveal adapter.

The system prompt in `apps/api/deck-agent.ts` includes live registry URLs from `buildRuntimeRegistryPromptSection()`.

## Validation errors

Common blocking issues:

| Code                       | Cause                                                  |
| -------------------------- | ------------------------------------------------------ |
| `external_url`             | Any `http://` or `https://` asset URL (including CDNs) |
| `unapproved_runtime_asset` | `/api/runtimes/...` path not in manifest               |
| `runtime_version_mismatch` | Asset URL version ≠ `data-ark-runtime-version`         |
| `missing_runtime_assets`   | Required CSS/JS not referenced                         |
| `invalid_runtime_marker`   | Unknown `data-ark-*` marker value                      |
| `script_without_marker`    | Non-runtime `<script>` without full-JS opt-in          |

## Manual full-JS reveal decks (discouraged)

Hand-written `data-ark-deck="nav"` decks with custom Reveal wiring are possible but **discouraged** for new decks. If used, still reference approved runtime assets (never CDNs) and dispatch `ark:deck-slide-change` / listen for `ark:deck-goto` per [deck-bridge.md](./deck-bridge.md).

Registry reveal decks should not use this path.

## Related

- [runtimes.md](./runtimes.md) — Registry model and `/api/runtimes`
- [deck-bridge.md](./deck-bridge.md) — Reveal adapter and slide index model
- `test/fixtures/reveal-registry-deck.html` — Minimal valid fixture
- `test/fixtures/reveal-vertical-deck.html` — Vertical stack fixture
- `test/fixtures/reveal-fragments-deck.html` — Fragments and backgrounds fixture
- `scripts/smoke-reveal-runtime.ts` — CI smoke test for preview asset loading
