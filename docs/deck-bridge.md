# Ark deck runtime bridge

Ark previews decks inside a sandboxed iframe (`sandbox="allow-scripts"`). The shell and the deck runtime communicate through a small, versioned `postMessage` protocol defined in `packages/deck-core/deck-bridge.ts`.

The shell-side lifecycle and ownership boundaries are summarized in
[deck-preview-orchestration.md](./deck-preview-orchestration.md). `DeckPreview`
retains iframe generation and frame-load security decisions while source
synchronization and shell shortcuts have narrow, transport-free owners.

When the user enables **Edit** mode in the preview chrome, Ark also injects a separate manual editor runtime (`packages/deck-core/deck-editor-bridge.ts`) that handles `ark:editor-*` messages for selection, geometry, and inline text editing. See [deck-editor-bridge.md](./deck-editor-bridge.md) for that protocol.

## Transport

| Direction            | Mechanism                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Shell → deck         | `window.postMessage` to the iframe                                                         |
| Deck → shell         | `window.parent.postMessage` from the iframe                                                |
| Full-JS deck scripts | DOM `CustomEvent`s inside the iframe; the injected bridge translates to/from `postMessage` |

Protocol version: `DECK_BRIDGE_PROTOCOL_VERSION` (currently `1`).

## Message types

### Parent → iframe

| Type                    | Payload                          | Purpose                                         |
| ----------------------- | -------------------------------- | ----------------------------------------------- |
| `ark:deck-goto`         | `{ index: number }`              | Navigate to a zero-based slide index            |
| `ark:deck-patch-slides` | `{ patchId, operations, index }` | Swap individual slides without a preview reload |

### iframe → parent

| Type                           | Payload                            | Purpose                                          |
| ------------------------------ | ---------------------------------- | ------------------------------------------------ |
| `ark:deck-ready`               | `{ index, slideCount, metadata }`  | Bridge is listening; initial slide and deck info |
| `ark:deck-slide-count`         | `{ slideCount }`                   | Slide count announcement or update               |
| `ark:deck-slide-change`        | `{ index }`                        | Active slide changed                             |
| `ark:deck-metadata`            | `{ metadata }`                     | Deck metadata announcement or update             |
| `ark:deck-patch-slides-result` | `{ patchId, applied, slideCount }` | Whether a slide patch landed                     |
| `ark:deck-runtime-error`       | `{ message, source? }`             | Uncaught error or unhandled rejection            |

### Slide patching

When a deck edit only touches slide markup, the shell swaps the affected slides
inside the loaded preview instead of creating a new preview session and
reloading the iframe. Untouched slides keep their DOM nodes and the viewer stays
on the slide they were watching: surviving identical slides are followed by
content identity (so an insert/delete before the active slide does not jump the
viewer), and a removed or replaced slide falls back to the same numeric index.

`operations` is a positional edit script applied in order against the evolving
slide list, so a changed slide is a `remove` followed by an `insert` at the same
index:

```ts
{ op: 'remove'; index: number } | { op: 'insert'; index: number; html: string }
```

The patch also carries a `slideIndexMap` (previous index → next index, or `-1`
when that slide was removed/replaced) so the shell can keep the viewer on the
same content across inserts and deletes before the active position.

The shell (`packages/deck-core/deck-slide-patch.ts`) only produces a patch when:

- the deck's scripts are stripped in preview (plain decks and approved reveal
  decks without the Chart.js addon) — replayed markup never re-runs deck script,
- every slide shares one parent element, and
- nothing outside the slide list changed (styles, head, scripts, containers).

Anything else falls back to a full reload, as does a runtime that answers with
`applied: false`, an unexpected `slideCount`, or no answer at all. `index` is the
slide to show once the patch lands; the runtime re-applies its own active-slide
state (`Reveal.sync()` for the reveal adapter) afterwards.

### Metadata shape

```ts
{
  runtime: 'plain' | 'reveal' | 'unknown'
  title: string
  previewMode: 'css-only' | 'full-js'
  protocolVersion: 1
}
```

## Preview modes

### CSS-only (default)

Ark strips deck scripts and injects `buildDeckCssNavRuntimeScript`. The shim:

- Finds slides using the shared selector chain (`section.slide`, `.reveal .slides > section`, etc.)
- Handles arrow-key navigation and parent `ark:deck-goto` messages
- Posts `ark:deck-ready`, `ark:deck-slide-count`, and `ark:deck-metadata` on load
- Posts `ark:deck-slide-change` after each navigation
- Applies `ark:deck-patch-slides` and re-shows the requested slide
- Forwards `window.error` and `unhandledrejection` as `ark:deck-runtime-error`

### Full-JS (explicit opt-in)

Set `data-ark-deck="nav"` on `<html>` when the deck owns navigation, or `data-ark-preview="full-js"` for libraries/charts without nav ownership. Ark keeps deck scripts and injects `buildDeckBridgeRuntimeScript`, which:

- Translates parent `ark:deck-goto` → `document` `CustomEvent('ark:deck-goto')`
- Translates deck `CustomEvent('ark:deck-slide-change')` → parent `postMessage`
- Announces ready/slide-count/metadata on load
- Forwards runtime errors to the parent

Deck scripts must **not** call `window.parent.postMessage` directly for navigation; dispatch DOM events instead.

### Reveal runtime (approved registry assets)

Decks with reveal runtime markers (`data-ark-runtime="reveal"`, etc.) and approved registry `reveal.js` assets use `buildRevealNavRuntimeScript` instead of the CSS shim. Ark:

- Preserves only approved registry `reveal.js` scripts
- Initializes Reveal once with preview-safe settings (`hash: false`, `keyboard: false`, `controls: false`, `progress: false`)
- Maps parent `ark:deck-goto` messages to `Reveal.slide(h, v, 0)`
- Reports `ark:deck-slide-change` using Reveal's flattened slide index (`getSlidePastCount`)
- Applies `ark:deck-patch-slides`, then `Reveal.sync()` and returns to the requested slide
- Announces `runtime: 'reveal'` and `previewMode: 'full-js'`

**Slide index model:** Ark uses a flattened linear index that matches Reveal's slide order. Each top-level horizontal slide without nested sections counts as one slide. A horizontal slide with vertical child sections expands into one index per vertical child. Fragment steps are not included in Ark indexes; fragment-only Reveal navigation does not update Ark slide state.

Reveal decks without approved registry assets continue to use the CSS-only shim. Custom full-JS decks (`data-ark-deck="nav"`) keep the explicit opt-in bridge path.

## Plain runtime contract

For hand-written decks with `section.slide` elements:

```html
<html data-ark-deck="nav">
  ...
  <script>
    ;(() => {
      const slides = [...document.querySelectorAll('section.slide')]
      let index = 0

      function setSlide(nextIndex) {
        index = Math.max(0, Math.min(slides.length - 1, nextIndex))
        slides.forEach((slide, i) => {
          const active = i === index
          slide.classList.toggle('active', active)
          slide.setAttribute('aria-hidden', String(!active))
        })
        document.dispatchEvent(new CustomEvent('ark:deck-slide-change', { detail: { index } }))
      }

      document.addEventListener('ark:deck-goto', (e) => setSlide(e.detail.index))
      setSlide(0)
    })()
  </script>
</html>
```

Requirements:

- Zero-based slide index; clamp in `setSlide`
- Dispatch `ark:deck-slide-change` on every slide change
- Listen for `ark:deck-goto` from the Ark bridge
- Avoid `history.replaceState` / `history.pushState` for slide URLs (sandbox may block them)

## Reveal.js runtime contract

See [reveal-runtime.md](./reveal-runtime.md) for the full authoring guide, feature matrix, and agent rules.

### Auto-wired reveal runtime (recommended)

Approved reveal registry decks only need runtime markers and registry asset URLs. Ark injects the reveal adapter automatically; no deck-authored bridge script is required.

```html
<html data-ark-runtime="reveal" data-ark-runtime-lib="reveal.js" data-ark-runtime-version="5.1.0">
  <head>
    <link rel="stylesheet" href="/api/runtimes/reveal.js/5.1.0/reveal.css" />
    <link rel="stylesheet" href="/api/runtimes/reveal.js/5.1.0/theme/white.css" />
  </head>
  <body>
    <div class="reveal">
      <div class="slides">
        <section>Title</section>
        <section>Detail</section>
      </div>
    </div>
    <script src="/api/runtimes/reveal.js/5.1.0/reveal.js"></script>
  </body>
</html>
```

### Manual custom-JS reveal decks (discouraged)

New reveal decks should use the **approved registry path** documented in [reveal-runtime.md](./reveal-runtime.md). Ark injects the reveal adapter automatically; no deck-authored bridge script is required.

For legacy hand-written decks that opt into full-JS mode with `data-ark-deck="nav"`, wire Reveal events to the bridge yourself. **CDN URLs are invalid** — use approved runtime assets only:

```html
<html data-ark-deck="nav" data-ark-runtime-lib="reveal.js" data-ark-runtime-version="5.1.0">
  <head>
    <link rel="stylesheet" href="/api/runtimes/reveal.js/5.1.0/reveal.css" />
    <link rel="stylesheet" href="/api/runtimes/reveal.js/5.1.0/theme/white.css" />
  </head>
  <body>
    <div class="reveal">
      <div class="slides">
        <section>Title</section>
        <section>Detail</section>
      </div>
    </div>
    <script src="/api/runtimes/reveal.js/5.1.0/reveal.js"></script>
    <script>
      Reveal.initialize({ hash: false, keyboard: false })

      function syncSlide() {
        const slide = Reveal.getCurrentSlide()
        const index =
          slide && typeof Reveal.getSlidePastCount === 'function'
            ? Reveal.getSlidePastCount(slide)
            : 0
        document.dispatchEvent(new CustomEvent('ark:deck-slide-change', { detail: { index } }))
      }

      Reveal.on('slidechanged', syncSlide)
      document.addEventListener('ark:deck-goto', (e) => {
        const slides = Reveal.getSlides()
        const target = slides[e.detail.index]
        if (target) {
          const { h, v } = Reveal.getIndices(target)
          Reveal.slide(h, v, 0)
        }
      })
      syncSlide()
    </script>
  </body>
</html>
```

In CSS-only preview (no approved reveal runtime script), Ark still detects `runtime: 'reveal'` from the DOM and navigates the static slide sections with the CSS shim.

## Shell helpers

`packages/deck-core/deck-bridge.ts` exports:

- Message constants and TypeScript types
- `createDeckGotoMessage`, `createDeckReadyMessage`, etc.
- `isDeckBridgeMessage`, `parseDeckBridgeMessage`, and per-type guards
- `postDeckGoto(target, index)` for the shell
- `buildDeckBridgeRuntimeScript` / `buildDeckCssNavRuntimeScript` / `buildRevealNavRuntimeScript` for preview injection

`useDeckSlideNavigation` uses these helpers and accepts optional `onDeckReady` / `onRuntimeError` callbacks.

## Security notes

- The shell only accepts runtime messages from the preview iframe's `contentWindow`
- Sandboxed preview iframes (`sandbox="allow-scripts"` without `allow-same-origin`) use an opaque origin serialized as `"null"`; parent listeners accept opaque origins and validate by `event.source` plus iframe generation instead of URL origin alone
- Parent → iframe `postMessage` uses target origin `*` so messages reach opaque-origin frames; iframe → parent messages target the configured app origin when available
- Preview uses `sandbox="allow-scripts"` without `allow-same-origin`
- Thumbnails prefer sandbox-rendered PNGs; the strip falls back to script-stripped `srcDoc` iframes (`sandbox=""`) when the renderer is unavailable (see [thumbnails.md](./thumbnails.md))
- **Residual risk — frame self-navigation:** full-JS decks can navigate the iframe itself (`location.href = ...`) despite `connect-src 'none'` (navigation is not a fetch; `navigate-to` CSP never shipped). The shell uses a **ref-gated bridge session** (`usePreviewBridgeSession`) with phases `idle` → `awaiting-handshake` → `armed` → `compromised`. An Ark head sentinel posts an additive `ark:deck-handshake` message using the per-generation preview-session capability, then removes its script node before deck-authored code runs. Ordinary parent→frame navigation traffic is allowed only while the session is `armed` (`canPostToFrame()`); editor traffic uses the separately transferred private port described in [deck-editor-bridge.md](./deck-editor-bridge.md). An unexpected second `load` on the same iframe generation flips `compromisedRef` **synchronously** before any downstream sync, tears down the preview, shows a security banner, and reports via `POST /api/runtime-errors`. Missing/invalid handshake after a bounded timeout also stops the preview. The first outbound navigation request cannot be prevented; containment of subsequent Ark bridge traffic is the mitigation — not a claim of complete isolation. Shell-triggered reloads remount the iframe via a content-sensitive `iframeKey` and start a new session.

## Sandbox host preview

Main preview and Present mode load decks from a separate sandbox origin (default `http://localhost:5174`) via short-lived render tokens:

1. Shell `POST /api/preview-sessions` with deck HTML → `{ token, handshake, renderUrl }`
2. Preview iframe loads `GET {sandboxOrigin}/render/{token}?parent={appOrigin}`
3. Sandbox host applies strict CSP/COOP/CORP response headers and serves processed preview HTML (handshake sentinel injected first in `<head>`)
4. Bridge scripts receive the parent app origin and reject parent messages from other origins
5. Shell arms the bridge session only after the expected handshake + trusted load lifecycle

Set `VITE_ARK_PREVIEW_SRCDOC=true` to force the legacy inline `srcDoc` preview path during migration.
