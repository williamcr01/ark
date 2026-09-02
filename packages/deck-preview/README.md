# @ark/deck-preview

**One job:** turning a deck document into something safe to render in the preview frame, and
carrying the shell ↔ frame conversation while it is rendered.

Layer 2. May import `@ark/deck`, `@ark/editor-runtime`, `@ark/runtime-registry`. Browser-safe.

| Module              | Responsibility                                                       |
| ------------------- | -------------------------------------------------------------------- |
| `preview-html.ts`   | Builds the document served to the preview frame                      |
| `preview-slides.ts` | Preview-time script stripping and runtime CSP injection              |
| `thumbnail-html.ts` | The stripped, single-slide document thumbnails render from           |
| `slide-patch.ts`    | Swaps changed slides inside a loaded preview instead of reloading it |
| `csp-nonce.ts`      | Per-render nonces for the injected CSP                               |

The parent ↔ deck navigation protocol (`ark:deck-*`) lives next to the injected iframe scripts:

```
protocol/   message-types.ts  the `ark:deck-*` wire identifiers
            types.ts          message and metadata shapes
            guards.ts         validation of incoming postMessage payloads
            factories.ts      message constructors and parent-side send helpers
runtime/    preamble.ts       shared injected-script snippets
            handshake.ts      head-first generation handshake sentinel
            css-nav.ts        CSS-only navigation shim
            custom-bridge.ts  full-JS custom-deck postMessage ↔ CustomEvent bridge
            reveal-adapter.ts Reveal.js navigation adapter
```

`deck-bridge.ts` is a re-export barrel so existing `@ark/deck-preview/deck-bridge.ts` importers do
not change. The injected scripts are still template-string sources, not compiled TypeScript.

Document-level sanitisation is not here: stripping inline handlers and `javascript:` URLs is in
`@ark/deck/document/sanitize.ts`, because patching a document has to strip the same vectors that
rendering one does.
