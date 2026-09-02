# @ark/deck

**One job:** the deck document model. Everything that reads, mutates, or validates deck HTML as a
document lives here, and nothing here knows about HTTP, storage, previews, or the agent.

Layer 1. May import `@ark/runtime-registry` and `@ark/telemetry`. Browser-safe: no `node:*`, no
`Buffer`, no Express, no React — the renderer bundles it.

```
document/   read a deck        parser, structure, slides, metadata, title, origin,
                               network, assets, image, editable, geometry, sanitize,
                               theme
patch/      change a deck      slide-ops, patch-request, editable-elements,
                               text-edit, text-box, jsdom-inline-style
patch/element-patch.ts         dispatcher: applyElementPatch and
                               stabilizeElementPatchOperations (public API)
patch/element/                 per-concern modules — types, resolve, validate, ids,
                               text, insert, style, layout (move/resize), order
                               (duplicate/delete/reorder), lock
validate/   judge a deck       document
```

`patch/element-patch.ts` is the public entry for element-level editor ops. Callers keep importing
that path; implementations live beside it in `patch/element/`. Helpers take a `Document` or
`Element`. JSDOM fragment construction for `insert_element` is isolated in `insert.ts` so a later
server-only split can move it.

`slide-ops.ts` holds an explicit `DeckDomCache` (`createDeckDomCache()` with `get` / `set` /
`clear`). A default instance is used by `applyDeckPatches`; tests call `resetDeckDomCache()`.

Two primitives are defined here and re-exported upward so the layering stays honest:

- `document/geometry.ts` — `NormalizedRect`, which the editor protocol re-exports as
  `EditorNormalizedRect`.
- `document/title.ts` — `extractDeckTitle` / `normalizeDeckTitle`, re-exported by `@ark/contracts`.

`document/sanitize.ts` (inline handlers, `javascript:` URLs) is here rather than in the preview
layer because patching a document has to strip the same vectors that rendering one does.

Server-side instrumentation stays out: `apps/api/deck-validate.ts` wraps the validator in JSDOM and
timing, and the agent's read/slice API is `apps/api/deck-html.ts`.
