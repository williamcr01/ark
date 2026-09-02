# @ark/deck-export

**One job:** describe a rendered slide as shapes PowerPoint can rebuild natively.

This package holds the scene model, the script that walks a slide inside the
render window, and the host-side pass that finishes what the walk collected. It
does not talk to Electron, PowerPoint, or the file system — it only says what a
slide _is_.

## Why a walk, not a parse

Deck HTML says nothing about where anything ends up: a slide centred with flex,
grid, or absolute positioning needs a layout engine to answer that. So the walk
runs in the render window after layout, after the deck's own scripts, and reads
measured geometry. The mechanism a deck used stops mattering; only the result
does.

## The constraint that shapes the model

OOXML carries **one** typeface per run of text with no fallback list, and a bold
flag rather than a weight axis. The scene model holds only what OOXML can
express. Where a deck uses CSS with no equivalent — `backdrop-filter`, `filter`,
`mix-blend-mode`, `clip-path`, masks, conic and layered backgrounds, generated
content — the walk emits a `raster` node marking the region to flatten and does
not descend into it. One unrepresentable element degrades itself and leaves the
rest of the slide editable.

## Geometry

Everything is CSS pixels against the 1280×720 reference frame, which is exactly
13.333in × 7.5in at 96dpi — PowerPoint's own widescreen slide. A pixel is 9525
EMU with no rounding, so nothing downstream carries a scale factor.

## Font resolution lives on the host

The in-page walk reports each run's raw CSS `font-family`. `finalizeSceneSlide`
maps it through `@ark/runtime-registry`'s font registry, so the typeface lookup
has one implementation, in TypeScript, under test — rather than a second copy
duplicated into an injected string.

## May import

`@ark/deck` (layer 1) and `@ark/runtime-registry` (layer 0). Browser-safe: no
`node:*`, no Express, no React. The runtime chunks are plain strings, so they are
never bundled as modules. The public entry is `@ark/deck-export` (`index.ts`);
deep imports remain supported.

## Testing

`runtime/extractor.test.ts` runs the injected script under JSDOM, which performs
no layout — each element declares its box with `data-rect` and the harness serves
that from `getBoundingClientRect`. The cascade, computed colours, and default
display of each tag are real. End-to-end behaviour against Chromium's actual
layout is covered by the desktop smoke test.
