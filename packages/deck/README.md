# @ark/deck

**One job:** the deck document model. Everything that reads, mutates, or validates deck HTML as a
document lives here, and nothing here knows about HTTP, storage, previews, or the agent.

Layer 1. May import `@ark/runtime-registry` and `@ark/telemetry`. Browser-safe: no `node:*`, no
`Buffer`, no Express, no React — the renderer bundles it.

```
document/   read a deck        parser, structure, slides, metadata, title, origin,
                               network, assets, image, editable, geometry, sanitize,
                               theme, stored-deck, document-history
patch/      change a deck      slide-ops, patch-request, element-patch,
                               editable-elements, text-edit, text-box
validate/   judge a deck       document
```

Primitives defined here and re-exported upward so the layering stays honest:

- `document/geometry.ts` — `NormalizedRect`, which the editor protocol re-exports as
  `EditorNormalizedRect`.
- `document/title.ts` — `extractDeckTitle` / `normalizeDeckTitle`, re-exported by `@ark/contracts`.
- `document/stored-deck.ts` / `document/document-history.ts` — Zod record shapes for a stored
  deck and bounded history snapshots. Persistence stays in `@ark/storage`; HTTP contracts and
  the renderer import these modules instead of the server-only package.

`document/sanitize.ts` (inline handlers, `javascript:` URLs) is here rather than in the preview
layer because patching a document has to strip the same vectors that rendering one does.

Server-side instrumentation stays out: `apps/api/deck-validate.ts` wraps the validator in JSDOM and
timing, and the agent's read/slice API is `apps/api/deck-html.ts`.
