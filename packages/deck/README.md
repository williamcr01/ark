# @ark/deck

**One job:** the deck document model. Everything that reads, mutates, or validates deck HTML as a
document lives here, and nothing here knows about HTTP, storage, previews, or the agent.

Layer 1. May import `@ark/runtime-registry`. Browser-safe: no `node:*`, no `Buffer`, no Express, no
React, no `jsdom` — the renderer bundles it. Callers pass a `Document`; this package never
constructs one from an HTML string. The public entry is `@ark/deck` (`index.ts`); deep imports
remain supported.

```
document/   read a deck        parser (parseDeckDocument), structure, slides, metadata, title,
                               origin, network, assets, image, editable, geometry, sanitize,
                               theme (theme-spec, theme-document), stored-deck, document-history
patch/      change a deck      slide-ops (applySlidePatch on a Document), patch-request,
                               editable-elements (classify/style), text-edit, text-box
patch/element-patch.ts         dispatcher: applyElementPatch and
                               stabilizeElementPatchOperations (public API)
patch/element/                 per-concern modules — types, resolve, validate, ids,
                               text, insert, style, layout (move/resize), order
                               (duplicate/delete/reorder), lock
validate/   judge a deck       document (validateDeckDocument / validateDeckHtml with
                               an injected parseDocument)
```

`patch/element-patch.ts` is the public entry for element-level editor ops. Callers keep importing
that path; implementations live beside it in `patch/element/`. Helpers take a `Document` or
`Element`. `insert_element` takes `parseFragment: (html) => Document` on `ElementPatchContext` so
this package never constructs a document.

`slide-ops.ts` applies a single `DeckPatchOperation` to a live `Document` (`applySlidePatch`).
HTML-string apply, JSDOM caching (`DeckDomCache`), and `applyDeckPatches` live in `@ark/deck-node`.

HTML-string entry points (`parseDeckHtml`, `readDeckThemeFromHtml`, `validateDeckHtmlOnServer`,
`applyDeckPatches`) live in `@ark/deck-node`. The renderer uses `parseDeckDocument` /
`validateDeckHtml` with the browser `DOMParser`.

Primitives defined here and re-exported upward so the layering stays honest:

- `document/geometry.ts` — `NormalizedRect`, which the editor protocol re-exports as
  `EditorNormalizedRect`.
- `document/title.ts` — `extractDeckTitle` / `normalizeDeckTitle`, re-exported by `@ark/contracts`.
- `document/stored-deck.ts` / `document/document-history.ts` — Zod record shapes for a stored
  deck and bounded history snapshots. Persistence stays in `@ark/storage`; HTTP contracts and
  the renderer import these modules instead of the server-only package.

`document/sanitize.ts` (inline handlers, `javascript:` URLs) is here rather than in the preview
layer because patching a document has to strip the same vectors that rendering one does.
