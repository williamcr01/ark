# @ark/deck-node

**One job:** JSDOM HTML entry points for the deck document model. Parsing, timed validation, and
patch apply that construct a `Document` from a string live here.

Layer 2. May import `@ark/deck`, `@ark/runtime-registry`, `@ark/telemetry`, `jsdom`, and `node:*`.
**Server-only:** the renderer must not import it. Use `@ark/deck` document/patch helpers with the
browser `DOMParser` instead.

```
document/   parse HTML         parser (parseDeckHtml → JSDOM → parseDeckDocument),
                               theme-html (readDeckThemeFromHtml and related)
validate/   judge HTML         timed (validateDeckHtmlOnServer / validateDeckDocumentOnServer)
patch/      change HTML        slide-ops (applyDeckPatches, DeckDomCache),
                               jsdom-inline-style (createDeckJsdom)
```

`parseDeckHtml` builds a JSDOM `Document` and delegates to `@ark/deck`'s `parseDeckDocument`.
`applyDeckPatches` owns the JSDOM cache and injects `parseFragment` into element ops so
`@ark/deck` never constructs a document.

`@ark/deck-import` is also layer 2 and must not import this package. Its tests build a `Document`
with JSDOM and call `parseDeckDocument`.
